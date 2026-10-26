# Gramoz Operational Runbook — Courier & Shipment Reconciliation

**Component:** Logistics Integration (Steadfast Courier / PostgreSQL Transactional Outbox)  
**Document Version:** 2.0.0 (TASK-27F Operational Remediation)  
**API Endpoints:**
- `GET /api/v1/admin/courier/reconciliations`
- `GET /api/v1/admin/courier/reconciliations/:eventId`
- `GET /api/v1/admin/courier/reconciliations/:eventId/audit`
- `POST /api/v1/admin/courier/reconciliations/:eventId/resolve`

---

## 1. Problem Statement & Invariant Policy

When dispatching an order to Steadfast Courier (`CREATE_CONSIGNMENT`), network timeouts, HTTP 500 errors, or gateway disconnects may occur after Steadfast accepts the consignment but before the response reaches Gramoz.

To prevent **duplicate shipments**, Gramoz marks the outbox event with:
```
RECONCILIATION_REQUIRED: Provider timeout or ambiguous response; invoice in doubt
```
The order consignment remains in sentinel state `PENDING_DISPATCH`, and the background worker halts automated retries on that event to protect inventory and logistics charges.

### Core Safety Invariant (TASK-27F)
> [!CRITICAL]
> **No new external consignment may be created merely because a provider lookup temporarily reports no shipment (HTTP 404).**  
> Carrier 404 lookup responses are inherently ambiguous: carrier databases experience read-replica lag or delayed ingest of newly accepted parcels. A 404 lookup does NOT constitute proof of non-existence.
>
> Re-dispatch (`CLEAR_AND_RETRY`) is strictly prohibited unless supported by **affirmative carrier rejection confirmation** (`confirmCarrierRejection: true`) AND a **verifiable evidence reference** (`evidenceRef`, min 5 chars, e.g., carrier support ticket number or portal log). Unverified administrator notes alone will be rejected with `InvalidOperationError` (HTTP 400).

---

## 2. Administrator Reconciliation Workflow

### Step 1: Discover Unresolved Dispatches
In the Admin Dashboard or via REST API:
```http
GET /api/v1/admin/courier/reconciliations?page=1&limit=20
Authorization: Bearer <ADMIN_JWT>
```
The response returns all failed or ambiguous events enriched with:
- Outbox event metadata (attempts, last error, timestamp).
- Order details (status, total amount, payment status).
- Customer details (email, phone, name).
- Shipping address (city, address line).

### Step 2: Inspect Event & Authoritative Provider Lookup
Call the detail inspection endpoint:
```http
GET /api/v1/admin/courier/reconciliations/:eventId
Authorization: Bearer <ADMIN_JWT>
```
This endpoint triggers an authoritative live lookup against Steadfast Courier using the merchant invoice number (`orderId`).

### Step 3: Authoritative Administrative Actions

The administrator executes one of three verified reconciliation actions:

#### Option A: `ADOPT_CONSIGNMENT`
**When to use:** The carrier portal or lookup confirms the consignment was created (e.g., consignment ID `CID-123456`).
```json
POST /api/v1/admin/courier/reconciliations/:eventId/resolve
{
  "action": "ADOPT_CONSIGNMENT",
  "consignmentId": "CID-123456",
  "notes": "Verified in Steadfast merchant panel under invoice INV-001",
  "evidenceRef": "STEADFAST-PANEL-LOOKUP-9921"
}
```
**Outcome:**
- Order `consignment_id` is updated to `CID-123456`.
- Order status is transitioned from `processing` to `shipped`.
- Outbox event status is set to `completed`.
- Append-only audit record is inserted into `courier_reconciliation_audit`.

#### Option B: `CLEAR_AND_RETRY` (Requires Verified Proof)
**When to use:** The carrier officially and affirmatively confirms that NO shipment was created or registered (e.g. carrier support ticket confirms order dropped before persistence), and the package must be re-dispatched.
```json
POST /api/v1/admin/courier/reconciliations/:eventId/resolve
{
  "action": "CLEAR_AND_RETRY",
  "notes": "Steadfast support agent Rafiq confirmed invoice INV-001 was never ingested.",
  "confirmCarrierRejection": true,
  "evidenceRef": "ST-TICKET-88291"
}
```
**Validation & Invariants:**
- `confirmCarrierRejection` must be explicitly `true`.
- `evidenceRef` must be provided (>= 5 characters).
- If the order already possesses a verified active consignment, the operation is rejected (`EntityConflictError`).
**Outcome:**
- Order `consignment_id` is cleared back to `NULL`.
- Outbox event is reset to `status = 'pending'` with `attempts = 0`.
- The background outbox processor will cleanly re-dispatch on the next cycle.
- Append-only audit record is inserted into `courier_reconciliation_audit`.

#### Option C: `CANCEL_DISPATCH`
**When to use:** Customer cancelled the order or delivery cannot proceed.
```json
POST /api/v1/admin/courier/reconciliations/:eventId/resolve
{
  "action": "CANCEL_DISPATCH",
  "notes": "Customer requested order cancellation prior to dispatch.",
  "evidenceRef": "CRM-CANCEL-TICKET-4410"
}
```
**Outcome:**
- Order sentinel is cleared to `NULL`.
- Outbox event is marked `completed`.
- Append-only audit record is inserted into `courier_reconciliation_audit`.

---

## 3. Durable Append-Only Audit Trail (TASK-27F)

Administrative actions are NOT merely stored in `outbox_events.last_error` (which can be overwritten on subsequent updates). Every reconciliation is permanently recorded in the dedicated `courier_reconciliation_audit` table:

```sql
SELECT 
    id, event_id, order_id, admin_id, admin_email,
    action, reason, evidence_ref,
    previous_state, new_state, created_at
FROM courier_reconciliation_audit
WHERE event_id = :eventId
ORDER BY created_at ASC;
```

### Audit Inspection Endpoint
Administrators and auditors can inspect the immutable history:
```http
GET /api/v1/admin/courier/reconciliations/:eventId/audit
Authorization: Bearer <ADMIN_JWT>
```

---

## 4. Concurrency & Integrity Protections

1. **Row-Level Serialization (`FOR UPDATE`):**
   `reconcileCourierDispatch()` executes inside an ACID transaction with pessimistic row locks on `outbox_events` and `orders`.
   If two administrators attempt to resolve simultaneously, the first commit succeeds and the second request receives `409 Conflict` (`Outbox event has already been reconciled or completed`).
2. **Worker Race Protection:**
   If an outbox worker attempts to claim or process the event while an administrator is adopting a consignment, the worker only claims events with `status = 'pending'`. The completed event is skipped, preventing duplicate consignments.
3. **Sentinels Overwrite Prevention:**
   An existing active consignment (`consignment_id NOT LIKE 'PENDING_%'`) cannot be cleared by `CLEAR_AND_RETRY` under any circumstance.
