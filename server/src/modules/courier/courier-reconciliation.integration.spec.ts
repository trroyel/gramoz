/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, sql } from 'drizzle-orm';
import * as schema from '@database/schema';
import { CourierService } from './courier.service';
import { OutboxProcessor } from '../orders/outbox.processor';
import { MailService } from '../notifications/mail.service';
import { SmsService } from '../notifications/sms.service';
import { ConfigService } from '@nestjs/config';
import {
  EntityConflictError,
  EntityNotFoundError,
  InvalidOperationError,
} from '../../common/errors/domain.errors';

describe('Carrier Reconciliation Operations & Concurrency Suite (TASK-27 Phase 5)', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle>;
  let courierService: CourierService;
  let processor: OutboxProcessor;
  let mockMailService: any;
  let mockSmsService: any;
  let mockConfigService: any;

  const testDbUrl =
    process.env.DATABASE_URL ||
    'postgresql://platform_user:platform_pass@localhost:5433/platform_db';

  const cleanups: {
    orderIds: string[];
    userIds: string[];
    addressIds: string[];
    outboxIds: string[];
  } = {
    orderIds: [],
    userIds: [],
    addressIds: [],
    outboxIds: [],
  };

  const admin1 = {
    id: 'a1111111-1111-1111-1111-111111111111',
    email: 'admin1@gramoz.test',
  };
  const admin2 = {
    id: 'a2222222-2222-2222-2222-222222222222',
    email: 'admin2@gramoz.test',
  };

  beforeAll(async () => {
    pool = new Pool({
      connectionString: testDbUrl,
      connectionTimeoutMillis: 5000,
      max: 20,
    });
    db = drizzle(pool, { schema });

    mockConfigService = {
      get: jest.fn().mockReturnValue('mock'),
    };

    courierService = new CourierService(
      mockConfigService as ConfigService,
      db as any,
    );

    mockMailService = {
      sendOrderConfirmation: jest.fn().mockResolvedValue(undefined),
      sendLowStockAlert: jest.fn().mockResolvedValue(undefined),
      sendAbandonedCartEmail: jest.fn().mockResolvedValue(undefined),
    };

    mockSmsService = {
      sendOrderShippedSms: jest.fn().mockResolvedValue(true),
      sendOrderDeliveredSms: jest.fn().mockResolvedValue(true),
      sendSms: jest.fn().mockResolvedValue(true),
    };

    processor = new OutboxProcessor(
      db as any,
      courierService,
      mockMailService as unknown as MailService,
      mockSmsService as unknown as SmsService,
    );

    // Clean up any lingering events from previously interrupted runs
    await pool.query(
      "DELETE FROM courier_reconciliation_audit WHERE reason LIKE '%Admin%' OR reason LIKE '%recon%' OR reason LIKE '%Steadfast%'",
    );
    await pool.query(
      "DELETE FROM outbox_events WHERE status = 'pending' AND type = 'CREATE_CONSIGNMENT'",
    );
  });

  afterAll(async () => {
    try {
      if (cleanups.outboxIds.length > 0) {
        await pool.query(
          'DELETE FROM courier_reconciliation_audit WHERE event_id = ANY($1::uuid[])',
          [cleanups.outboxIds],
        );
        await pool.query(
          'DELETE FROM outbox_events WHERE id = ANY($1::uuid[])',
          [cleanups.outboxIds],
        );
      }
      if (cleanups.orderIds.length > 0) {
        await pool.query('DELETE FROM orders WHERE id = ANY($1::uuid[])', [
          cleanups.orderIds,
        ]);
      }
      if (cleanups.addressIds.length > 0) {
        await pool.query('DELETE FROM addresses WHERE id = ANY($1::uuid[])', [
          cleanups.addressIds,
        ]);
      }
      if (cleanups.userIds.length > 0) {
        await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [
          cleanups.userIds,
        ]);
      }
    } finally {
      await pool.end();
    }
  });

  async function seedOrderFixture(options?: {
    paymentStatus?: 'unpaid' | 'paid';
    status?:
      | 'pending'
      | 'confirmed'
      | 'processing'
      | 'shipped'
      | 'delivered'
      | 'cancelled';
    consignmentId?: string | null;
  }) {
    const userRes = await pool.query(`
      INSERT INTO users (email, password_hash, full_name, phone, role)
      VALUES ('recon_${Date.now()}_${Math.random().toString(36).substring(7)}@test.com', 'hash', 'Recon Customer', '8801700112233', 'customer')
      RETURNING id;
    `);
    const userId = userRes.rows[0].id;
    cleanups.userIds.push(userId);

    const addrRes = await pool.query(
      `
      INSERT INTO addresses (user_id, title, address_line_1, city)
      VALUES ($1, 'Office', 'House 50, Road 11, Banani', 'Dhaka')
      RETURNING id;
    `,
      [userId],
    );
    const addressId = addrRes.rows[0].id;
    cleanups.addressIds.push(addressId);

    const orderRes = await pool.query(
      `
      INSERT INTO orders (user_id, shipping_address_id, total_amount, delivery_charge, payment_status, status, consignment_id)
      VALUES ($1, $2, '2500.00', '70.00', $3, $4, $5)
      RETURNING id;
    `,
      [
        userId,
        addressId,
        options?.paymentStatus ?? 'paid',
        options?.status ?? 'processing',
        options?.consignmentId !== undefined
          ? options.consignmentId
          : 'PENDING_DISPATCH',
      ],
    );
    const orderId = orderRes.rows[0].id;
    cleanups.orderIds.push(orderId);

    return { userId, addressId, orderId };
  }

  async function seedOutboxEvent(
    orderId: string,
    options?: {
      status?: 'pending' | 'processing' | 'completed' | 'failed';
      lastError?: string;
      attempts?: number;
    },
  ) {
    const res = await pool.query(
      `
      INSERT INTO outbox_events (type, payload, status, last_error, attempts)
      VALUES ('CREATE_CONSIGNMENT', $1, $2, $3, $4)
      RETURNING id;
    `,
      [
        JSON.stringify({ orderId }),
        options?.status ?? 'failed',
        options?.lastError ??
          'Steadfast create_order timeout; RECONCILIATION_REQUIRED',
        options?.attempts ?? 3,
      ],
    );
    const eventId = res.rows[0].id;
    cleanups.outboxIds.push(eventId);
    return eventId;
  }

  describe('1. Unresolved Reconciliations Discovery & Detail Inspection', () => {
    it('discovers events requiring reconciliation and enriches with order and user metadata', async () => {
      const { orderId } = await seedOrderFixture();
      const eventId = await seedOutboxEvent(orderId, {
        status: 'failed',
        lastError:
          'RECONCILIATION_REQUIRED: Provider timeout, invoice in doubt',
      });

      const list = await courierService.getUnresolvedReconciliations(1, 10);
      expect(list.items.length).toBeGreaterThan(0);
      const found = list.items.find((i) => i.eventId === eventId);
      expect(found).toBeDefined();
      expect(found?.orderId).toBe(orderId);
      expect(found?.user?.email).toContain('recon_');
      expect(found?.address?.addressLine1).toBe('House 50, Road 11, Banani');
    });

    it('fetches reconciliation detail including provider lookup attempt', async () => {
      const { orderId } = await seedOrderFixture();
      const eventId = await seedOutboxEvent(orderId);

      // Mock getConsignmentByInvoice on courierService instance
      jest
        .spyOn(courierService, 'getConsignmentByInvoice')
        .mockResolvedValueOnce({
          success: true,
          consignmentId: 'STEADFAST-991122',
          trackingCode: 'TRK-991122',
        });

      const detail = await courierService.getReconciliationDetail(eventId);
      expect(detail.event.id).toBe(eventId);
      expect(detail.order.id).toBe(orderId);
      expect(detail.providerStatus).toEqual({
        success: true,
        consignmentId: 'STEADFAST-991122',
        trackingCode: 'TRK-991122',
      });
    });
  });

  describe('2. Concurrency: Two Administrators Resolve the Same Event', () => {
    it('serializes concurrent resolutions; first succeeds and second gets EntityConflictError', async () => {
      const { orderId } = await seedOrderFixture();
      const eventId = await seedOutboxEvent(orderId);

      // Both admins attempt to resolve concurrently
      const promise1 = courierService.reconcileCourierDispatch(
        admin1,
        eventId,
        {
          action: 'ADOPT_CONSIGNMENT',
          consignmentId: 'CID-ADMIN-1',
          notes: 'Admin 1 authoritative adoption',
        },
      );

      const promise2 = courierService.reconcileCourierDispatch(
        admin2,
        eventId,
        {
          action: 'ADOPT_CONSIGNMENT',
          consignmentId: 'CID-ADMIN-2',
          notes: 'Admin 2 authoritative adoption',
        },
      );

      const results = await Promise.allSettled([promise1, promise2]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const rejReason = rejected[0].reason;
      expect(rejReason).toBeInstanceOf(EntityConflictError);
      expect(rejReason.message).toContain(
        'already been reconciled or completed',
      );

      // Verify DB final state is immutable from the winner
      const [order] = await db
        .select()
        .from(schema.orders)
        .where(eq(schema.orders.id, orderId));
      expect(order.consignmentId).toBe('CID-ADMIN-1');
      expect(order.status).toBe('shipped');

      const [event] = await db
        .select()
        .from(schema.outboxEvents)
        .where(eq(schema.outboxEvents.id, eventId));
      expect(event.status).toBe('completed');
      expect(event.lastError).toContain('Action=ADOPT_CONSIGNMENT');
      expect(event.lastError).toContain('CID-ADMIN-1');
    });
  });

  describe('3. Worker Retry Races with Administrative Resolution', () => {
    it('prevents worker from creating duplicate consignment if admin adopts during worker processing', async () => {
      const { orderId } = await seedOrderFixture();
      const eventId = await seedOutboxEvent(orderId, { status: 'pending' });

      // Admin resolves the event while worker is about to process
      await courierService.reconcileCourierDispatch(admin1, eventId, {
        action: 'ADOPT_CONSIGNMENT',
        consignmentId: 'CID-RACE-WINNER',
        notes: 'Admin won race against retry worker',
      });

      // Worker runs processOutbox
      const createSpy = jest.spyOn(courierService, 'createConsignment');
      await processor.processOutbox();

      // Worker should NOT attempt to create consignment for this order because event is already completed
      expect(createSpy).not.toHaveBeenCalledWith(
        expect.objectContaining({ orderId }),
      );

      const [order] = await db
        .select()
        .from(schema.orders)
        .where(eq(schema.orders.id, orderId));
      expect(order.consignmentId).toBe('CID-RACE-WINNER');
    });
  });

  describe('4. Provider Timeout Followed by Delayed Consignment Appearance', () => {
    it('adopts delayed consignment safely without generating a duplicate dispatch', async () => {
      const { orderId } = await seedOrderFixture({
        consignmentId: 'PENDING_DISPATCH',
      });
      const eventId = await seedOutboxEvent(orderId, {
        status: 'failed',
        lastError: 'RECONCILIATION_REQUIRED: Provider timeout on initial call',
      });

      // Later query to provider returns the delayed consignment
      jest
        .spyOn(courierService, 'getConsignmentByInvoice')
        .mockResolvedValueOnce({
          success: true,
          consignmentId: 'CID-DELAYED-7744',
          trackingCode: 'TRK-DELAYED-7744',
        });

      const inspection = await courierService.getReconciliationDetail(eventId);
      expect(inspection.providerStatus?.consignmentId).toBe('CID-DELAYED-7744');

      // Admin confirms and adopts this discovered consignment
      const res = await courierService.reconcileCourierDispatch(
        admin1,
        eventId,
        {
          action: 'ADOPT_CONSIGNMENT',
          consignmentId: inspection.providerStatus.consignmentId,
          notes: 'Discovered delayed consignment via provider invoice lookup',
        },
      );

      expect(res.success).toBe(true);
      expect(res.consignmentId).toBe('CID-DELAYED-7744');

      const [order] = await db
        .select()
        .from(schema.orders)
        .where(eq(schema.orders.id, orderId));
      expect(order.consignmentId).toBe('CID-DELAYED-7744');
      expect(order.status).toBe('shipped');
    });
  });

  describe('5. Carrier 404 Ambiguity Safety & Re-dispatch Invariant (TASK-27F)', () => {
    it('rejects CLEAR_AND_RETRY when provider reports 404 but admin does not affirm carrier rejection', async () => {
      const { orderId } = await seedOrderFixture({
        consignmentId: 'PENDING_DISPATCH',
      });
      const eventId = await seedOutboxEvent(orderId, {
        status: 'failed',
        lastError: 'RECONCILIATION_REQUIRED: Provider timeout on initial call',
      });

      // Provider lookup returns 404 / null
      jest
        .spyOn(courierService, 'getConsignmentByInvoice')
        .mockResolvedValueOnce(null);

      // Admin tries to clear based only on 404 without affirmative confirmation
      await expect(
        courierService.reconcileCourierDispatch(admin1, eventId, {
          action: 'CLEAR_AND_RETRY',
          notes:
            'Provider returns 404, attempting to clear sentinel immediately',
          confirmCarrierRejection: false,
        }),
      ).rejects.toThrow(InvalidOperationError);
    });

    it('rejects CLEAR_AND_RETRY when affirmative flag is set but verifiable evidenceRef is missing', async () => {
      const { orderId } = await seedOrderFixture({
        consignmentId: 'PENDING_DISPATCH',
      });
      const eventId = await seedOutboxEvent(orderId, {
        status: 'failed',
        lastError: 'RECONCILIATION_REQUIRED: Provider timeout on initial call',
      });

      // Admin checks flag but provides no evidence reference
      await expect(
        courierService.reconcileCourierDispatch(admin1, eventId, {
          action: 'CLEAR_AND_RETRY',
          notes: 'Cleared without ticket or carrier evidence reference',
          confirmCarrierRejection: true,
          evidenceRef: '   ',
        }),
      ).rejects.toThrow(InvalidOperationError);
    });

    it('clears dispatch sentinel and resets outbox to pending when provider 404 is backed by confirmed carrier rejection and evidenceRef', async () => {
      const { orderId } = await seedOrderFixture({
        consignmentId: 'PENDING_DISPATCH',
      });
      const eventId = await seedOutboxEvent(orderId, {
        status: 'failed',
        lastError: 'RECONCILIATION_REQUIRED: Ambiguous 500 error from carrier',
      });

      // Provider confirms 404 / no order
      jest
        .spyOn(courierService, 'getConsignmentByInvoice')
        .mockResolvedValueOnce(null);

      const inspection = await courierService.getReconciliationDetail(eventId);
      expect(inspection.providerStatus).toBeNull();

      // Admin provides positive evidence and confirms carrier rejection
      const res = await courierService.reconcileCourierDispatch(
        admin2,
        eventId,
        {
          action: 'CLEAR_AND_RETRY',
          notes:
            'Steadfast agent confirmed invoice was not registered. Support ticket #ST-88291.',
          confirmCarrierRejection: true,
          evidenceRef: 'ST-TICKET-88291',
        },
      );

      expect(res.success).toBe(true);

      const [order] = await db
        .select()
        .from(schema.orders)
        .where(eq(schema.orders.id, orderId));
      expect(order.consignmentId).toBeNull();

      const [event] = await db
        .select()
        .from(schema.outboxEvents)
        .where(eq(schema.outboxEvents.id, eventId));
      expect(event.status).toBe('pending');
      expect(event.attempts).toBe(0);
      expect(event.lastError).toContain('Action=CLEAR_AND_RETRY');
      expect(event.lastError).toContain('ST-TICKET-88291');
    });
  });

  describe('6. Duplicate Event Replay & Invalid Operations', () => {
    it('rejects duplicate reconciliation on an already-resolved event', async () => {
      const { orderId } = await seedOrderFixture();
      const eventId = await seedOutboxEvent(orderId);

      await courierService.reconcileCourierDispatch(admin1, eventId, {
        action: 'CANCEL_DISPATCH',
        notes: 'Customer cancelled order before dispatch',
      });

      // Attempt second resolution
      await expect(
        courierService.reconcileCourierDispatch(admin2, eventId, {
          action: 'ADOPT_CONSIGNMENT',
          consignmentId: 'CID-LATE',
          notes: 'Late resolution attempt',
        }),
      ).rejects.toThrow(EntityConflictError);
    });

    it('rejects CLEAR_AND_RETRY if order already has an active verified consignment', async () => {
      const { orderId } = await seedOrderFixture({
        consignmentId: 'ACTIVE-CID-5555',
      });
      const eventId = await seedOutboxEvent(orderId, { status: 'failed' });

      await expect(
        courierService.reconcileCourierDispatch(admin1, eventId, {
          action: 'CLEAR_AND_RETRY',
          notes: 'Trying to clear already active consignment',
          confirmCarrierRejection: true,
          evidenceRef: 'TICKET-12345',
        }),
      ).rejects.toThrow(EntityConflictError);
    });

    it('throws EntityNotFoundError for non-existent event ID', async () => {
      await expect(
        courierService.reconcileCourierDispatch(
          admin1,
          '00000000-0000-0000-0000-000000000000',
          {
            action: 'CANCEL_DISPATCH',
            notes: 'Non existent',
          },
        ),
      ).rejects.toThrow(EntityNotFoundError);
    });
  });

  describe('7. Append-Only Durable Reconciliation Audit Trail (TASK-27F)', () => {
    it('records immutable audit log in courier_reconciliation_audit with state transitions and admin attribution', async () => {
      const { orderId } = await seedOrderFixture({
        consignmentId: 'PENDING_DISPATCH',
      });
      const eventId = await seedOutboxEvent(orderId, { status: 'failed' });

      // Admin adopts consignment
      await courierService.reconcileCourierDispatch(admin1, eventId, {
        action: 'ADOPT_CONSIGNMENT',
        consignmentId: 'CID-AUDIT-TEST-001',
        notes:
          'Adopting verified consignment after phone verification with dispatcher',
        evidenceRef: 'DISPATCHER-CALL-LOG-449',
      });

      // Query audit history via service
      const history =
        await courierService.getReconciliationAuditHistory(eventId);
      expect(history.length).toBe(1);

      const auditRecord = history[0];
      expect(auditRecord.eventId).toBe(eventId);
      expect(auditRecord.orderId).toBe(orderId);
      expect(auditRecord.adminId).toBe(admin1.id);
      expect(auditRecord.adminEmail).toBe(admin1.email);
      expect(auditRecord.action).toBe('ADOPT_CONSIGNMENT');
      expect(auditRecord.evidenceRef).toBe('DISPATCHER-CALL-LOG-449');
      expect(auditRecord.reason).toContain('phone verification');
      expect(auditRecord.previousState).toEqual({
        outboxStatus: 'failed',
        outboxAttempts: 3,
        orderConsignmentId: 'PENDING_DISPATCH',
        orderStatus: 'processing',
      });
      expect(auditRecord.newState).toEqual({
        outboxStatus: 'completed',
        outboxAttempts: 3,
        orderConsignmentId: 'CID-AUDIT-TEST-001',
        orderStatus: 'shipped',
      });
      expect(auditRecord.createdAt).toBeInstanceOf(Date);
    });

    it('records audit log for CANCEL_DISPATCH with appropriate states', async () => {
      const { orderId } = await seedOrderFixture({
        consignmentId: 'PENDING_DISPATCH',
      });
      const eventId = await seedOutboxEvent(orderId, { status: 'failed' });

      await courierService.reconcileCourierDispatch(admin2, eventId, {
        action: 'CANCEL_DISPATCH',
        notes: 'Fraud detected, dispatch cancelled permanently',
        evidenceRef: 'FRAUD-CASE-9921',
      });

      const history =
        await courierService.getReconciliationAuditHistory(eventId);
      expect(history.length).toBe(1);
      expect(history[0].action).toBe('CANCEL_DISPATCH');
      expect(history[0].adminEmail).toBe(admin2.email);
      expect(history[0].evidenceRef).toBe('FRAUD-CASE-9921');
      expect(history[0].newState).toEqual({
        outboxStatus: 'completed',
        outboxAttempts: 3,
        orderConsignmentId: null,
        orderStatus: 'processing',
      });
    });
  });
});
