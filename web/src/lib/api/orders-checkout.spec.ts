import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ordersApi } from './orders';
import { paymentsApi } from './payments';

describe('Frontend Checkout API, Idempotency & Concurrency (TASK-08)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('attaches Idempotency-Key header when idempotencyKey is provided in checkout payload', async () => {
    let capturedHeaders: Record<string, string> = {};
    let capturedBody = '';

    global.fetch = vi.fn().mockImplementation((url, init) => {
      capturedHeaders = init?.headers ?? {};
      capturedBody = init?.body ?? '';
      return Promise.resolve({
        ok: true,
        status: 201,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () =>
          JSON.stringify({
            success: true,
            data: {
              id: 'order-uuid-123',
              totalAmount: '350.00',
              status: 'pending',
              paymentStatus: 'unpaid',
            },
          }),
      } as unknown as Response);
    });

    const res = await ordersApi.checkout({
      addressLine1: 'Road 10, Banani',
      city: 'Dhaka',
      phone: '01711223344',
      idempotencyKey: 'frontend-idemp-uuid-456',
    });

    expect(res.success).toBe(true);
    expect(res.data.id).toBe('order-uuid-123');
    expect(capturedHeaders['Idempotency-Key']).toBe('frontend-idemp-uuid-456');
    const parsedBody = JSON.parse(capturedBody);
    expect(parsedBody.idempotencyKey).toBe('frontend-idemp-uuid-456');
  });

  it('handles backend insufficient stock error correctly', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () =>
        JSON.stringify({
          success: false,
          error: {
            message: '"Premium Shirt" just sold out. Please remove it from your cart.',
          },
        }),
    } as unknown as Response);

    await expect(
      ordersApi.checkout({
        addressLine1: 'Road 10, Banani',
        city: 'Dhaka',
        phone: '01711223344',
        idempotencyKey: 'idemp-fail-1',
      }),
    ).rejects.toThrow('just sold out');
  });

  it('handles phone number verification required error correctly', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () =>
        JSON.stringify({
          success: false,
          error: {
            message: 'Phone number verification is required to place an order.',
          },
        }),
    } as unknown as Response);

    await expect(
      ordersApi.checkout({
        addressLine1: 'Road 10, Banani',
        city: 'Dhaka',
        phone: '01711223344',
      }),
    ).rejects.toThrow('Phone number verification is required');
  });

  it('successfully transitions from checkout to payment gateway initiation', async () => {
    // 1. Mock checkout success
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () =>
          JSON.stringify({
            success: true,
            data: { id: 'order-step-1', totalAmount: '500.00' },
          }),
      } as unknown as Response)
      // 2. Mock payment initiation
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () =>
          JSON.stringify({
            success: true,
            data: { gatewayUrl: 'https://sandbox.sslcommerz.com/gwprocess/v4/pay' },
          }),
      } as unknown as Response);

    const orderRes = await ordersApi.checkout({
      addressLine1: 'Dhanmondi 27',
      city: 'Dhaka',
      phone: '01711223344',
      idempotencyKey: 'idemp-flow-1',
    });
    expect(orderRes.data.id).toBe('order-step-1');

    const payRes = await paymentsApi.initiate(orderRes.data.id, 'sslcommerz');
    expect(payRes.success).toBe(true);
    expect(payRes.data.gatewayUrl).toContain('sslcommerz.com');
  });

  it('preserves the same idempotency key during a client retry after a network timeout', async () => {
    const fixedKey = 'retry-idemp-key-789';
    let callCount = 0;
    const capturedKeys: string[] = [];

    global.fetch = vi.fn().mockImplementation((url, init) => {
      callCount++;
      const headers = init?.headers ?? {};
      if (headers['Idempotency-Key']) {
        capturedKeys.push(headers['Idempotency-Key']);
      }

      if (callCount === 1) {
        // First attempt simulates network timeout
        return Promise.reject(new Error('Network timeout'));
      }

      // Retry attempt succeeds
      return Promise.resolve({
        ok: true,
        status: 201,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () =>
          JSON.stringify({
            success: true,
            data: { id: 'order-retried-123', totalAmount: '400.00' },
          }),
      } as unknown as Response);
    });

    const checkoutPayload = {
      addressLine1: 'Uttara Sector 3',
      city: 'Dhaka',
      phone: '01711223344',
      idempotencyKey: fixedKey,
    };

    // First attempt fails with network error
    await expect(ordersApi.checkout(checkoutPayload)).rejects.toThrow('Network timeout');

    // Immediate retry with the exact same idempotency key
    const retryRes = await ordersApi.checkout(checkoutPayload);
    expect(retryRes.success).toBe(true);
    expect(retryRes.data.id).toBe('order-retried-123');

    // Verify both attempts used the exact same idempotency key
    expect(capturedKeys).toEqual([fixedKey, fixedKey]);
  });

  it('handles empty cart error from backend gracefully', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () =>
        JSON.stringify({
          success: false,
          error: { message: 'Your cart is empty' },
        }),
    } as unknown as Response);

    await expect(
      ordersApi.checkout({
        addressLine1: 'Road 5, Mirpur',
        city: 'Dhaka',
        phone: '01711000000',
      }),
    ).rejects.toThrow('Your cart is empty');
  });

  it('handles unexpected 500 server errors gracefully', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () =>
        JSON.stringify({
          success: false,
          message: 'Internal server error occurred during transaction',
        }),
    } as unknown as Response);

    await expect(
      ordersApi.checkout({
        addressLine1: 'Road 5, Mirpur',
        city: 'Dhaka',
        phone: '01711000000',
      }),
    ).rejects.toThrow('Internal server error');
  });
});
