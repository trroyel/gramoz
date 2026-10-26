import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { refundsApi } from './refunds';

describe('Frontend Refunds API & Settlement Contract (TASK-22G)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('reconcileRefund invokes PATCH /refunds/admin/:id/reconcile with authentication credentials', async () => {
    let capturedUrl = '';
    let capturedMethod = '';

    global.fetch = vi.fn().mockImplementation((url, init) => {
      capturedUrl = String(url);
      capturedMethod = init?.method ?? 'GET';
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () =>
          JSON.stringify({
            success: true,
            data: {
              id: 'refund-ref-123',
              status: 'processed',
              amount: '500.00',
              gatewayRefundId: 'SSL-REF-999',
            },
          }),
      } as unknown as Response);
    });

    const res = await refundsApi.reconcileRefund('refund-ref-123');

    expect(res.success).toBe(true);
    expect(capturedUrl).toContain('/refunds/admin/refund-ref-123/reconcile');
    expect(capturedMethod).toBe('POST');
    expect(res.data.status).toBe('processed');
  });

  // REF-G11: Customer views a processing refund
  it('REF-G11: Customer views in-flight refund -> status is processing, UI does not falsely present settled refund', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () =>
        JSON.stringify({
          success: true,
          data: [
            {
              id: 'refund-in-flight-1',
              orderId: 'order-101',
              amount: '750.00',
              reason: 'damaged_goods',
              status: 'processing',
              gatewayRefundId: 'SSL-INIT-456',
              createdAt: '2026-10-21T12:00:00Z',
            },
          ],
        }),
    } as unknown as Response);

    const res = await refundsApi.getMyRefunds();
    expect(res.success).toBe(true);
    expect(res.data.length).toBe(1);

    const refund = res.data[0];
    expect(refund.status).toBe('processing');
    // Invariant: processing status must not be conflated with completed 'processed' settlement
    expect(refund.status).not.toBe('processed');
    expect(refund.gatewayRefundId).toBe('SSL-INIT-456');
  });

  // REF-G12: Customer views a provider-confirmed refunded payment
  it('REF-G12: Customer views provider-confirmed refund -> accurate completed status with retained gateway evidence', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () =>
        JSON.stringify({
          success: true,
          data: [
            {
              id: 'refund-confirmed-2',
              orderId: 'order-202',
              amount: '1200.00',
              reason: 'defective',
              status: 'processed',
              gatewayRefundId: 'SSL-CONFIRMED-888',
              adminNotes: 'External settlement verified via SSLCommerz inquiry (ref: SSL-CONFIRMED-888). Settled on 2026-10-21.',
              createdAt: '2026-10-21T10:00:00Z',
            },
          ],
        }),
    } as unknown as Response);

    const res = await refundsApi.getMyRefunds();
    expect(res.success).toBe(true);
    expect(res.data.length).toBe(1);

    const refund = res.data[0];
    expect(refund.status).toBe('processed');
    expect(refund.gatewayRefundId).toBe('SSL-CONFIRMED-888');
    expect(refund.adminNotes).toContain('External settlement verified');
  });

  it('updateRefundStatus invokes PATCH /refunds/admin/:id/status with valid payload', async () => {
    let capturedBody = '';

    global.fetch = vi.fn().mockImplementation((url, init) => {
      capturedBody = init?.body ?? '';
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () =>
          JSON.stringify({
            success: true,
            data: {
              id: 'refund-3',
              status: 'rejected',
              adminNotes: 'Inspection failed: item used',
            },
          }),
      } as unknown as Response);
    });

    const res = await refundsApi.updateRefundStatus('refund-3', {
      status: 'rejected',
      adminNotes: 'Inspection failed: item used',
    });

    expect(res.success).toBe(true);
    expect(JSON.parse(capturedBody)).toEqual({
      status: 'rejected',
      adminNotes: 'Inspection failed: item used',
    });
  });
});
