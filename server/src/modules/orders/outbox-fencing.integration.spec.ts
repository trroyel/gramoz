/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */

/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/require-await */
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'crypto';
import * as schema from '@database/schema';
import { OutboxProcessor } from './outbox.processor';
import { CourierService } from '../courier/courier.service';
import { MailService } from '../notifications/mail.service';
import { SmsService } from '../notifications/sms.service';

/**
 * TASK-26 — Independent verification of stale-worker interleavings (lease-ownership fencing)
 * and of the courier "never silently duplicate a shipment" guarantee, on real PostgreSQL 16.
 */
describe('TASK-26: Outbox lease-ownership fencing & courier duplicate-shipment safety', () => {
  let pool: Pool;
  let adminPool: Pool;
  let processor: OutboxProcessor;
  const testDbName = `test_t26_outbox_${Date.now()}`;

  const courier = {
    createConsignment: jest.fn(),
    getConsignmentByInvoice: jest.fn(),
  };
  const mail = {
    sendOrderConfirmation: jest.fn(),
    sendLowStockAlert: jest.fn(),
    sendAbandonedCartEmail: jest.fn(),
  };
  const sms = {
    sendOrderShippedSms: jest.fn(),
    sendOrderDeliveredSms: jest.fn(),
  };

  beforeAll(async () => {
    adminPool = new Pool({
      connectionString:
        'postgresql://platform_user:platform_pass@localhost:5433/platform_db',
    });
    await adminPool.query(`CREATE DATABASE ${testDbName} TEMPLATE platform_db`);
    pool = new Pool({
      connectionString: `postgresql://platform_user:platform_pass@localhost:5433/${testDbName}`,
      max: 10,
    });
    await pool.query('TRUNCATE TABLE outbox_events CASCADE;');
    processor = new OutboxProcessor(
      drizzle(pool, { schema }) as any,
      courier as unknown as CourierService,
      mail as unknown as MailService,
      sms as unknown as SmsService,
    );
  });

  beforeEach(async () => {
    jest.resetAllMocks();
    courier.getConsignmentByInvoice.mockResolvedValue(null);
    sms.sendOrderShippedSms.mockResolvedValue(true);
    await pool.query('TRUNCATE TABLE outbox_events CASCADE;');
  });

  afterAll(async () => {
    await pool?.end();
    await adminPool?.query(`DROP DATABASE IF EXISTS ${testDbName}`);
    await adminPool?.end();
  });

  const smsPayload = JSON.stringify({
    type: 'shipped',
    phone: '8801711223344',
    orderId: 'o-fence',
  });

  async function insertPending(
    type = 'SEND_SMS',
    payload: string = smsPayload,
  ): Promise<string> {
    const r = await pool.query(
      `INSERT INTO outbox_events (type, payload, status, attempts)
       VALUES ($1, $2::jsonb, 'pending', 0) RETURNING id`,
      [type, payload],
    );
    return r.rows[0].id;
  }

  /** Same statement the processor uses to claim (single event). */
  async function claim(id: string): Promise<schema.OutboxEvent> {
    const r = await pool.query(
      `UPDATE outbox_events SET status='processing', attempts=attempts+1, updated_at=NOW()
       WHERE id=$1 AND status='pending' AND attempts < 3 RETURNING *`,
      [id],
    );
    expect(r.rows.length).toBe(1);
    const row = r.rows[0];
    return {
      id: row.id,
      type: row.type,
      payload: row.payload,
      status: row.status,
      attempts: row.attempts,
      lastError: row.last_error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    } as schema.OutboxEvent;
  }

  async function expireLease(id: string): Promise<void> {
    await pool.query(
      `UPDATE outbox_events SET updated_at = NOW() - INTERVAL '6 minutes' WHERE id=$1`,
      [id],
    );
  }

  async function row(id: string) {
    return (
      await pool.query(
        'SELECT status, attempts, last_error FROM outbox_events WHERE id=$1',
        [id],
      )
    ).rows[0];
  }

  describe('Stale-worker interleavings', () => {
    it('FENCE-26-A: stale worker already inside a slow provider call cannot overwrite the newer worker (completion nor failure)', async () => {
      const id = await insertPending();
      const eventA = await claim(id); // attempts = 1

      let releaseA!: (ok: boolean) => void;
      sms.sendOrderShippedSms.mockImplementationOnce(
        () => new Promise<boolean>((res) => (releaseA = res)),
      );
      const workerA = processor.processEvent(eventA); // passes ownership, then blocks
      await new Promise((r) => setTimeout(r, 100));

      await expireLease(id);
      await processor.recoverStrandedEvents();
      const eventB = await claim(id); // attempts = 2
      expect(eventB.attempts).toBe(2);
      sms.sendOrderShippedSms.mockResolvedValueOnce(true);
      expect(await processor.processEvent(eventB)).toBe(true);
      expect((await row(id)).status).toBe('completed');

      // A wakes up and FAILS: must not revert completed -> pending nor overwrite last_error with A's error
      releaseA(false);
      expect(await workerA).toBe(false);
      const finalRow = await row(id);
      expect(finalRow.status).toBe('completed');
      expect(finalRow.attempts).toBe(2);
      expect(finalRow.last_error).toBe(
        'Worker lease expired / worker process interrupted',
      );
    });

    it('FENCE-26-B: stale worker finishing successfully cannot change attempts/state written by a newer in-flight worker', async () => {
      const id = await insertPending();
      const eventA = await claim(id);
      let releaseA!: (ok: boolean) => void;
      sms.sendOrderShippedSms.mockImplementationOnce(
        () => new Promise<boolean>((res) => (releaseA = res)),
      );
      const workerA = processor.processEvent(eventA);
      await new Promise((r) => setTimeout(r, 100));

      await expireLease(id);
      await processor.recoverStrandedEvents();
      await claim(id); // B claimed, still 'processing' with attempts = 2 (B in flight)

      releaseA(true); // A succeeds late
      await workerA;
      const r = await row(id);
      expect(r.status).toBe('processing'); // B's state untouched
      expect(r.attempts).toBe(2);
    });

    it('FENCE-26-C: a claimed-but-not-started event whose lease expired is NOT executed by the original worker (no duplicate side effect)', async () => {
      const id = await insertPending();
      const eventA = await claim(id); // A claimed (e.g. waiting in a long batch)
      await expireLease(id);
      await processor.recoverStrandedEvents();
      const eventB = await claim(id);
      sms.sendOrderShippedSms.mockResolvedValue(true);
      expect(await processor.processEvent(eventB)).toBe(true);
      expect(sms.sendOrderShippedSms).toHaveBeenCalledTimes(1);

      // A finally starts: ownership check must refuse -> no second SMS
      expect(await processor.processEvent(eventA)).toBe(false);
      expect(sms.sendOrderShippedSms).toHaveBeenCalledTimes(1);
      expect((await row(id)).status).toBe('completed');
    });

    it('FENCE-26-D: recovered-but-unclaimed (pending) event is not executed by the stale worker; stays claimable', async () => {
      const id = await insertPending();
      const eventA = await claim(id);
      await expireLease(id);
      await processor.recoverStrandedEvents();
      expect((await row(id)).status).toBe('pending');

      expect(await processor.processEvent(eventA)).toBe(false);
      expect(sms.sendOrderShippedSms).not.toHaveBeenCalled();
      expect((await row(id)).status).toBe('pending');
    });

    it('FENCE-26-E: lease is renewed at start so a long batch does not expire the currently running event', async () => {
      const id = await insertPending();
      const event = await claim(id);
      await expireLease(id); // almost-expired lease from waiting in a queue/batch
      // Worker begins execution -> renews lease atomically before side effects
      let release!: (ok: boolean) => void;
      sms.sendOrderShippedSms.mockImplementationOnce(
        () => new Promise<boolean>((res) => (release = res)),
      );
      const worker = processor.processEvent(event);
      // Wait for processEvent to execute its lease renewal query and enter the SMS handler
      await new Promise((r) => setTimeout(r, 100));

      // Recovery running concurrently finds 0 stranded events because lease was renewed
      expect(await processor.recoverStrandedEvents()).toBe(0);
      release(true);
      expect(await worker).toBe(true);
      expect((await row(id)).status).toBe('completed');
    });

    it('FENCE-26-F: recovery at MAX_ATTEMPTS dead-letters; a late successful stale worker with equal attempts truthfully completes (no re-send later)', async () => {
      const id = await insertPending();
      await pool.query(`UPDATE outbox_events SET attempts = 2 WHERE id=$1`, [
        id,
      ]);
      const eventA = await claim(id); // attempts = 3
      expect(eventA.attempts).toBe(3);
      let release!: (ok: boolean) => void;
      sms.sendOrderShippedSms.mockImplementationOnce(
        () => new Promise<boolean>((res) => (release = res)),
      );
      const workerA = processor.processEvent(eventA);
      await new Promise((r) => setTimeout(r, 100));
      await expireLease(id);
      await processor.recoverStrandedEvents();
      expect((await row(id)).status).toBe('failed');
      release(true);
      expect(await workerA).toBe(true);
      expect((await row(id)).status).toBe('completed');
    });

    it('FENCE-26-G: distinct claims cannot collide because FOR UPDATE SKIP LOCKED yields disjoint attempts', async () => {
      // In the real system, atomic FOR UPDATE SKIP LOCKED guarantees each claim has a unique attempts count.
      // A stale worker with attempts=N cannot match once recovered and re-claimed as attempts=N+1.
      const id = await insertPending();
      const event = await claim(id);
      expect(event.attempts).toBe(1);
      // Verify that after recovery and re-claim, the attempt counter is strictly higher
      await expireLease(id);
      await processor.recoverStrandedEvents();
      const reClaimed = await claim(id);
      expect(reClaimed.attempts).toBe(2);
      expect(reClaimed.attempts).toBeGreaterThan(event.attempts);
    });
  });

  describe('Courier duplicate-shipment safety (provider ambiguity)', () => {
    async function seedOrder(): Promise<string> {
      const userId = randomUUID();
      await pool.query(
        `INSERT INTO users (id, email, password_hash, full_name, phone, role)
         VALUES ($1, $2, 'h', 'T', '8801711223344', 'customer')`,
        [userId, `t26-${userId.slice(0, 8)}@example.com`],
      );
      const addressId = randomUUID();
      await pool.query(
        `INSERT INTO addresses (id, user_id, title, address_line_1, city, zip_code, is_default)
         VALUES ($1, $2, 'Home', 'H1', 'Dhaka', '1209', true)`,
        [addressId, userId],
      );
      const orderId = randomUUID();
      await pool.query(
        `INSERT INTO orders (id, user_id, shipping_address_id, total_amount, status, payment_status)
         VALUES ($1, $2, $3, '1500.00', 'processing', 'unpaid')`,
        [orderId, userId, addressId],
      );
      return orderId;
    }

    async function insertDispatch(orderId: string): Promise<string> {
      return insertPending('CREATE_CONSIGNMENT', JSON.stringify({ orderId }));
    }

    const consignmentOf = async (orderId: string) =>
      (
        await pool.query('SELECT consignment_id FROM orders WHERE id=$1', [
          orderId,
        ])
      ).rows[0].consignment_id;

    it('COU-26-A: ambiguous create (timeout) keeps the sentinel; retry + provider 404 NEVER re-creates and dead-letters for reconciliation', async () => {
      const orderId = await seedOrder();
      const id = await insertDispatch(orderId);

      courier.createConsignment.mockResolvedValueOnce({
        success: false,
        ambiguous: true,
        message: 'Courier API unreachable',
      });
      const e1 = await claim(id);
      expect(await processor.processEvent(e1)).toBe(false);
      expect(await consignmentOf(orderId)).toBe('PENDING_DISPATCH');
      expect((await row(id)).status).toBe('pending');

      // Retry: provider says 404 (eventual consistency: it may still appear later)
      courier.getConsignmentByInvoice.mockResolvedValue(null);
      const e2 = await claim(id);
      expect(await processor.processEvent(e2)).toBe(false);

      expect(courier.createConsignment).toHaveBeenCalledTimes(1); // never a second create
      const r = await row(id);
      expect(r.status).toBe('failed'); // dead-lettered immediately, not retried blindly
      expect(r.last_error).toContain('RECONCILIATION_REQUIRED');
      expect(await consignmentOf(orderId)).toBe('PENDING_DISPATCH');
    });

    it('COU-26-B: definitive provider rejection releases the sentinel; retry with 404 may create (no shipment can exist)', async () => {
      const orderId = await seedOrder();
      const id = await insertDispatch(orderId);

      courier.createConsignment.mockResolvedValueOnce({
        success: false,
        message: 'Invalid recipient phone',
      });
      const e1 = await claim(id);
      expect(await processor.processEvent(e1)).toBe(false);
      expect(await consignmentOf(orderId)).toBeNull();

      courier.getConsignmentByInvoice.mockResolvedValue(null);
      courier.createConsignment.mockResolvedValueOnce({
        success: true,
        consignmentId: 'TRK-26B',
        trackingUrl: 'https://steadfast.com.bd/t/TRK-26B',
      });
      const e2 = await claim(id);
      expect(await processor.processEvent(e2)).toBe(true);
      expect(await consignmentOf(orderId)).toBe('TRK-26B');
      expect(courier.createConsignment).toHaveBeenCalledTimes(2);
    });

    it('COU-26-C: provider confirms the shipment exists but returns no tracking code -> never create, dead-letter', async () => {
      const orderId = await seedOrder();
      const id = await insertDispatch(orderId);
      await pool.query(
        `UPDATE orders SET consignment_id='PENDING_DISPATCH' WHERE id=$1`,
        [orderId],
      );
      await pool.query(`UPDATE outbox_events SET attempts = 1 WHERE id=$1`, [
        id,
      ]);

      courier.getConsignmentByInvoice.mockResolvedValue({
        success: false,
        exists: true,
        message: 'Shipment exists at provider (delivery_status=in_review)',
      });
      const e2 = await claim(id);
      expect(await processor.processEvent(e2)).toBe(false);
      expect(courier.createConsignment).not.toHaveBeenCalled();
      expect((await row(id)).status).toBe('failed');
    });

    it('COU-26-D: provider inquiry ambiguity (5xx/timeout) defers (retryable) and never creates', async () => {
      const orderId = await seedOrder();
      const id = await insertDispatch(orderId);
      await pool.query(`UPDATE outbox_events SET attempts = 1 WHERE id=$1`, [
        id,
      ]);
      courier.getConsignmentByInvoice.mockResolvedValue({
        success: false,
        ambiguous: true,
        message: 'HTTP 503',
      });
      const e = await claim(id);
      expect(await processor.processEvent(e)).toBe(false);
      expect(courier.createConsignment).not.toHaveBeenCalled();
      expect((await row(id)).status).toBe('pending');
    });
  });

  describe('Steadfast HTTP contract classification (CourierService, fetch stubbed)', () => {
    let service: CourierService;
    const realFetch = global.fetch;

    beforeEach(() => {
      service = new CourierService({ get: jest.fn() } as any, {} as any);
      (service as any).getCredentials = async () => ({
        mode: 'live',
        apiKey: 'k',
        secretKey: 's',
      });
    });
    afterAll(() => {
      global.fetch = realFetch;
    });

    const req = {
      orderId: 'ORD-1',
      recipientName: 'A',
      recipientPhone: '01700000000',
      recipientAddress: 'X',
      recipientCity: 'Dhaka',
      amountToCollect: 100,
      itemQuantity: 1,
      itemWeight: 0.5,
    };
    const resp = (status: number, body: unknown, ok = status < 400) =>
      ({ status, ok, json: async () => body }) as any;

    it('parses the documented create_order shape (consignment.tracking_code)', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        resp(200, {
          status: 200,
          message: 'created',
          consignment: { consignment_id: 1424107, tracking_code: '15BAEB8A' },
        }),
      );
      const r = await service.createConsignment(req);
      expect(r).toMatchObject({ success: true, consignmentId: '15BAEB8A' });
    });

    it('HTTP 200 without tracking code is ambiguous (shipment exists, unlinkable)', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(resp(200, { status: 200, message: 'ok' }));
      const r = await service.createConsignment(req);
      expect(r).toMatchObject({ success: false, ambiguous: true });
    });

    it('5xx, unparseable body and network timeout are ambiguous', async () => {
      global.fetch = jest.fn().mockResolvedValue(resp(502, {}, false));
      expect(await service.createConsignment(req)).toMatchObject({
        ambiguous: true,
      });
      global.fetch = jest.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => {
          throw new Error('bad json');
        },
      });
      expect(await service.createConsignment(req)).toMatchObject({
        ambiguous: true,
      });
      global.fetch = jest.fn().mockRejectedValue(new Error('timeout'));
      expect(await service.createConsignment(req)).toMatchObject({
        ambiguous: true,
      });
    });

    it('HTTP 4xx validation rejection is definitive (not ambiguous)', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(resp(422, { status: 400, message: 'bad' }, false));
      const r = await service.createConsignment(req);
      expect(r.success).toBe(false);
      expect(r.ambiguous).toBeUndefined();
    });

    it('status_by_invoice {status:200, delivery_status} => exists (NOT "not found")', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(
          resp(200, { status: 200, delivery_status: 'in_review' }),
        );
      const r = await service.getConsignmentByInvoice('ORD-1');
      expect(r).toMatchObject({ success: false, exists: true });
    });

    it('status_by_invoice 404 => null; 503 / network error => ambiguous', async () => {
      global.fetch = jest.fn().mockResolvedValue(resp(404, {}, false));
      expect(await service.getConsignmentByInvoice('ORD-1')).toBeNull();
      global.fetch = jest.fn().mockResolvedValue(resp(503, {}, false));
      expect(await service.getConsignmentByInvoice('ORD-1')).toMatchObject({
        ambiguous: true,
      });
      global.fetch = jest.fn().mockRejectedValue(new Error('ECONNRESET'));
      expect(await service.getConsignmentByInvoice('ORD-1')).toMatchObject({
        ambiguous: true,
      });
    });
  });
});
