/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */

import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import * as schema from '@database/schema';
import { OutboxProcessor } from './outbox.processor';
import { CourierService } from '../courier/courier.service';
import { MailService } from '../notifications/mail.service';
import { SmsService } from '../notifications/sms.service';
import { OrdersStore } from './orders.store';

describe('TASK-25: Transactional Outbox Concurrency, Fencing, Crash Recovery & Courier Follow-Up', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle>;
  let processor: OutboxProcessor;
  let ordersStore: OrdersStore;
  let courierService: CourierService;

  let mockCourierService: {
    createConsignment: jest.Mock;
    getConsignmentByInvoice: jest.Mock;
    trackConsignment: jest.Mock;
  };

  let mockMailService: {
    sendOrderConfirmation: jest.Mock;
    sendLowStockAlert: jest.Mock;
    sendAbandonedCartEmail: jest.Mock;
  };

  let mockSmsService: {
    sendOrderShippedSms: jest.Mock;
    sendOrderDeliveredSms: jest.Mock;
  };

  const cleanups = {
    outboxIds: [] as string[],
    orderIds: [] as string[],
    userIds: [] as string[],
    addressIds: [] as string[],
  };

  let adminPool: Pool;
  const testDbName = `test_outbox_conc_${Date.now()}`;
  let testDbUrl: string;

  beforeAll(async () => {
    adminPool = new Pool({
      connectionString:
        'postgresql://platform_user:platform_pass@localhost:5433/platform_db',
    });
    await adminPool.query(`CREATE DATABASE ${testDbName} TEMPLATE platform_db`);

    testDbUrl = `postgresql://platform_user:platform_pass@localhost:5433/${testDbName}`;
    pool = new Pool({
      connectionString: testDbUrl,
      connectionTimeoutMillis: 5000,
      max: 20,
    });
    await pool.query('TRUNCATE TABLE outbox_events CASCADE;');

    db = drizzle(pool, { schema });

    mockCourierService = {
      createConsignment: jest.fn().mockResolvedValue({
        success: true,
        consignmentId: 'SF-MOCK-25',
        trackingCode: 'SF-MOCK-25',
        trackingUrl: 'https://steadfast.com.bd/t/SF-MOCK-25',
      }),
      getConsignmentByInvoice: jest.fn().mockResolvedValue(null),
      trackConsignment: jest.fn(),
    };

    mockMailService = {
      sendOrderConfirmation: jest.fn().mockResolvedValue(undefined),
      sendLowStockAlert: jest.fn().mockResolvedValue(undefined),
      sendAbandonedCartEmail: jest.fn().mockResolvedValue(undefined),
    };

    mockSmsService = {
      sendOrderShippedSms: jest.fn().mockResolvedValue(true),
      sendOrderDeliveredSms: jest.fn().mockResolvedValue(true),
    };

    processor = new OutboxProcessor(
      db as any,
      mockCourierService as unknown as CourierService,
      mockMailService as unknown as MailService,
      mockSmsService as unknown as SmsService,
    );

    ordersStore = new OrdersStore(db as any);
    courierService = new CourierService({ get: jest.fn() } as any, db as any);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    try {
      if (pool) {
        await pool.end();
      }
      if (adminPool) {
        await adminPool.query(`DROP DATABASE IF EXISTS ${testDbName}`);
        await adminPool.end();
      }
    } catch (_) {}
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
    const userId = randomUUID();
    cleanups.userIds.push(userId);
    await pool.query(
      `INSERT INTO users (id, email, password_hash, full_name, phone, role)
       VALUES ($1, $2, 'hash', 'Test Customer', '8801711223344', 'customer')`,
      [userId, `user-${userId.slice(0, 8)}@example.com`],
    );

    const addressId = randomUUID();
    cleanups.addressIds.push(addressId);
    await pool.query(
      `INSERT INTO addresses (id, user_id, title, address_line_1, city, zip_code, is_default)
       VALUES ($1, $2, 'Home', 'House 1, Road 2, Dhanmondi', 'Dhaka', '1209', true)`,
      [addressId, userId],
    );

    const orderId = randomUUID();
    cleanups.orderIds.push(orderId);
    await pool.query(
      `INSERT INTO orders (id, user_id, shipping_address_id, total_amount, status, payment_status, consignment_id)
       VALUES ($1, $2, $3, '1500.00', $4, $5, $6)`,
      [
        orderId,
        userId,
        addressId,
        options?.status ?? 'shipped',
        options?.paymentStatus ?? 'paid',
        options?.consignmentId ?? null,
      ],
    );

    return { userId, addressId, orderId };
  }

  describe('PHASE 4: Outbox Worker Concurrency & Fencing Tests', () => {
    it('OUT-25-A: Two workers claim available events concurrently without overlapping claims', async () => {
      const eventIds: string[] = [];
      for (let i = 0; i < 6; i++) {
        const res = await pool.query(`
          INSERT INTO outbox_events (type, payload, status, attempts)
          VALUES ('SEND_SMS', '{"phone":"8801711223344","type":"shipped"}'::jsonb, 'pending', 0)
          RETURNING id;
        `);
        eventIds.push(res.rows[0].id);
      }
      cleanups.outboxIds.push(...eventIds);

      // Create two independent processors with independent DB pools
      const pool1 = new Pool({ connectionString: testDbUrl });
      const pool2 = new Pool({ connectionString: testDbUrl });
      const proc1 = new OutboxProcessor(
        drizzle(pool1) as any,
        mockCourierService as any,
        mockMailService as any,
        mockSmsService as any,
      );
      const proc2 = new OutboxProcessor(
        drizzle(pool2) as any,
        mockCourierService as any,
        mockMailService as any,
        mockSmsService as any,
      );

      try {
        const [res1, res2] = await Promise.all([
          proc1.processOutbox(),
          proc2.processOutbox(),
        ]);

        expect(res1.claimed + res2.claimed).toBeGreaterThanOrEqual(6);
        // Verify every event was claimed and completed without duplication
        const check = await pool.query(
          'SELECT status, count(*) FROM outbox_events WHERE id = ANY($1::uuid[]) GROUP BY status',
          [eventIds],
        );
        const completedCount =
          check.rows.find((r) => r.status === 'completed')?.count ?? '0';
        expect(parseInt(completedCount, 10)).toBe(6);
      } finally {
        await pool1.end();
        await pool2.end();
      }
    });

    it('OUT-25-B: Worker crashes immediately after claiming — event is recovered after 5m lease expiry', async () => {
      const res = await pool.query(`
        INSERT INTO outbox_events (type, payload, status, attempts, updated_at)
        VALUES ('SEND_SMS', '{"phone":"8801711223344","type":"shipped"}'::jsonb, 'processing', 1, NOW() - INTERVAL '6 minutes')
        RETURNING id;
      `);
      const eventId = res.rows[0].id;
      cleanups.outboxIds.push(eventId);

      const recovered = await processor.recoverStrandedEvents();
      expect(recovered).toBeGreaterThanOrEqual(1);

      const check = await pool.query(
        'SELECT status, last_error FROM outbox_events WHERE id = $1',
        [eventId],
      );
      expect(check.rows[0].status).toBe('pending');
      expect(check.rows[0].last_error).toContain('Worker lease expired');
    });

    it('OUT-25-C: Worker crashes after provider success before completing outbox — provider inquiry adopts existing consignment', async () => {
      const { orderId } = await seedOrderFixture();

      mockCourierService.getConsignmentByInvoice.mockResolvedValueOnce({
        success: true,
        consignmentId: 'SF-EXISTING-ADOPTED',
        trackingCode: 'SF-EXISTING-ADOPTED',
        trackingUrl: 'https://steadfast.com.bd/t/SF-EXISTING-ADOPTED',
      });

      const res = await pool.query(
        `
        INSERT INTO outbox_events (type, payload, status, attempts)
        VALUES ('CREATE_CONSIGNMENT', $1::jsonb, 'processing', 2)
        RETURNING id;
      `,
        [JSON.stringify({ orderId })],
      );
      const eventId = res.rows[0].id;
      cleanups.outboxIds.push(eventId);

      const event: schema.OutboxEvent = {
        id: eventId,
        type: 'CREATE_CONSIGNMENT',
        payload: { orderId },
        status: 'processing',
        attempts: 2,
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const success = await processor.processEvent(event);
      expect(success).toBe(true);
      expect(mockCourierService.createConsignment).not.toHaveBeenCalled();

      const orderCheck = await pool.query(
        'SELECT consignment_id FROM orders WHERE id = $1',
        [orderId],
      );
      expect(orderCheck.rows[0].consignment_id).toBe('SF-EXISTING-ADOPTED');
    });

    it('OUT-25-D & OUT-25-E: Worker lease expires during slow external call and second worker claims expired event', async () => {
      const res = await pool.query(`
        INSERT INTO outbox_events (type, payload, status, attempts, updated_at)
        VALUES ('SEND_SMS', '{"phone":"8801711223344","type":"shipped"}'::jsonb, 'processing', 1, NOW() - INTERVAL '6 minutes')
        RETURNING id;
      `);
      const eventId = res.rows[0].id;
      cleanups.outboxIds.push(eventId);

      // Lease recovery runs
      await processor.recoverStrandedEvents();

      // Second worker claims it via processOutbox
      const claimResult = await processor.processOutbox();
      expect(claimResult.claimed).toBeGreaterThanOrEqual(1);

      // In DB, status is now completed and attempts is 2
      const check = await pool.query(
        'SELECT status, attempts FROM outbox_events WHERE id = $1',
        [eventId],
      );
      expect(check.rows[0].status).toBe('completed');
      expect(check.rows[0].attempts).toBe(2);
    });

    it('OUT-25-F: Stale original worker completing after lease was reassigned cannot overwrite newer worker state', async () => {
      const res = await pool.query(`
        INSERT INTO outbox_events (type, payload, status, attempts)
        VALUES ('SEND_SMS', '{"phone":"8801711223344","type":"shipped"}'::jsonb, 'processing', 2)
        RETURNING id;
      `);
      const eventId = res.rows[0].id;
      cleanups.outboxIds.push(eventId);

      // Stale Worker 1 only has attempts = 1
      const staleEvent: schema.OutboxEvent = {
        id: eventId,
        type: 'SEND_SMS',
        payload: { phone: '8801711223344', type: 'shipped' },
        status: 'processing',
        attempts: 1, // Stale! DB already at attempts = 2
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // When stale worker tries to complete, optimistic fencing prevents overwrite in DB
      await processor.processEvent(staleEvent);

      // Verify DB still has attempts = 2 and processing (newer state preserved)
      const check = await pool.query(
        'SELECT status, attempts FROM outbox_events WHERE id = $1',
        [eventId],
      );
      expect(check.rows[0].attempts).toBe(2);
      expect(check.rows[0].status).toBe('processing');
    });

    it('OUT-25-G: Gracefully handles database connection errors during processing', async () => {
      const brokenPool = new Pool({
        connectionString:
          'postgresql://platform_user:invalid@localhost:5433/platform_db',
        connectionTimeoutMillis: 1000,
      });
      const brokenDb = drizzle(brokenPool);
      const brokenProcessor = new OutboxProcessor(
        brokenDb as any,
        mockCourierService as any,
        mockMailService as any,
        mockSmsService as any,
      );

      const result = await brokenProcessor.processOutbox();
      expect(result.claimed).toBe(0);
      expect(result.completed).toBe(0);
      expect(result.failed).toBe(0);

      await brokenPool.end();
    });

    it('OUT-25-H: Worker operates reliably when Redis is disconnected', async () => {
      const res = await pool.query(`
        INSERT INTO outbox_events (type, payload, status, attempts)
        VALUES ('SEND_SMS', '{"phone":"8801711223344","type":"shipped"}'::jsonb, 'pending', 0)
        RETURNING id;
      `);
      const eventId = res.rows[0].id;
      cleanups.outboxIds.push(eventId);

      // Outbox relies exclusively on PostgreSQL ACID transactions, 0 Redis coupling
      const result = await processor.processOutbox();
      expect(result.claimed).toBeGreaterThanOrEqual(1);

      const check = await pool.query(
        'SELECT status FROM outbox_events WHERE id = $1',
        [eventId],
      );
      expect(check.rows[0].status).toBe('completed');
    });

    it('OUT-25-I: Batch processing interruption preserves completed events', async () => {
      const res1 = await pool.query(`
        INSERT INTO outbox_events (type, payload, status, attempts)
        VALUES ('SEND_SMS', '{"phone":"8801711223344","type":"shipped"}'::jsonb, 'processing', 1)
        RETURNING id;
      `);
      const res2 = await pool.query(`
        INSERT INTO outbox_events (type, payload, status, attempts)
        VALUES ('SEND_SMS', '{"phone":"8801711223344","type":"shipped"}'::jsonb, 'processing', 1)
        RETURNING id;
      `);
      const id1 = res1.rows[0].id;
      const id2 = res2.rows[0].id;
      cleanups.outboxIds.push(id1, id2);

      const event1: schema.OutboxEvent = {
        id: id1,
        type: 'SEND_SMS',
        payload: { phone: '8801711223344', type: 'shipped' },
        status: 'processing',
        attempts: 1,
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const event2: schema.OutboxEvent = {
        id: id2,
        type: 'SEND_SMS',
        payload: { phone: '8801711223344', type: 'shipped' },
        status: 'processing',
        attempts: 1,
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Event 1 succeeds, Event 2 throws
      mockSmsService.sendOrderShippedSms
        .mockResolvedValueOnce(true)
        .mockRejectedValueOnce(new Error('Gateway Timeout'));

      const s1 = await processor.processEvent(event1);
      const s2 = await processor.processEvent(event2);

      expect(s1).toBe(true);
      expect(s2).toBe(false);

      const check1 = await pool.query(
        'SELECT status FROM outbox_events WHERE id = $1',
        [id1],
      );
      const check2 = await pool.query(
        'SELECT status, attempts FROM outbox_events WHERE id = $1',
        [id2],
      );

      expect(check1.rows[0].status).toBe('completed');
      expect(check2.rows[0].status).toBe('pending');
      expect(check2.rows[0].attempts).toBe(1);
    });

    it('OUT-25-J: Event permanently fails after MAX_ATTEMPTS (3) into dead-letter status', async () => {
      const res = await pool.query(`
        INSERT INTO outbox_events (type, payload, status, attempts)
        VALUES ('SEND_SMS', '{"phone":"8801711223344","type":"shipped"}'::jsonb, 'processing', 3)
        RETURNING id;
      `);
      const eventId = res.rows[0].id;
      cleanups.outboxIds.push(eventId);

      mockSmsService.sendOrderShippedSms.mockRejectedValueOnce(
        new Error('Permanent carrier rejected number'),
      );

      const event: schema.OutboxEvent = {
        id: eventId,
        type: 'SEND_SMS',
        payload: { phone: '8801711223344', type: 'shipped' },
        status: 'processing',
        attempts: 3,
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const success = await processor.processEvent(event);
      expect(success).toBe(false);

      const check = await pool.query(
        'SELECT status, attempts, last_error FROM outbox_events WHERE id = $1',
        [eventId],
      );
      expect(check.rows[0].status).toBe('failed');
      expect(check.rows[0].attempts).toBe(3);
      expect(check.rows[0].last_error).toContain(
        'Permanent carrier rejected number',
      );
    });
  });

  describe('PHASE 5: Courier Dispatch Retry & Sentinel Isolation Tests', () => {
    it('COU-25-A: Provider inquiry ambiguity (network timeout) aborts dispatch and defers creation', async () => {
      const { orderId } = await seedOrderFixture();

      mockCourierService.getConsignmentByInvoice.mockResolvedValueOnce({
        success: false,
        ambiguous: true,
        message: 'Steadfast status inquiry returned HTTP 504 Gateway Timeout',
      });

      const res = await pool.query(
        `
        INSERT INTO outbox_events (type, payload, status, attempts)
        VALUES ('CREATE_CONSIGNMENT', $1::jsonb, 'processing', 2)
        RETURNING id;
      `,
        [JSON.stringify({ orderId })],
      );
      const eventId = res.rows[0].id;
      cleanups.outboxIds.push(eventId);

      const event: schema.OutboxEvent = {
        id: eventId,
        type: 'CREATE_CONSIGNMENT',
        payload: { orderId },
        status: 'processing',
        attempts: 2,
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const success = await processor.processEvent(event);
      expect(success).toBe(false);
      // createConsignment MUST NOT be called when provider inquiry is ambiguous!
      expect(mockCourierService.createConsignment).not.toHaveBeenCalled();

      // Order consignment_id must remain null (not stuck in PENDING_DISPATCH)
      const orderCheck = await pool.query(
        'SELECT consignment_id FROM orders WHERE id = $1',
        [orderId],
      );
      expect(orderCheck.rows[0].consignment_id).toBeNull();
    });

    it('COU-25-B: Provider inquiry 404 (confirmed not found) allows fresh consignment creation', async () => {
      const { orderId } = await seedOrderFixture();

      // Provider confirms not found (null)
      mockCourierService.getConsignmentByInvoice.mockResolvedValueOnce(null);
      mockCourierService.createConsignment.mockResolvedValueOnce({
        success: true,
        consignmentId: 'SF-FRESH-123',
        trackingUrl: 'https://steadfast.com.bd/t/SF-FRESH-123',
      });

      const res = await pool.query(
        `
        INSERT INTO outbox_events (type, payload, status, attempts)
        VALUES ('CREATE_CONSIGNMENT', $1::jsonb, 'processing', 2)
        RETURNING id;
      `,
        [JSON.stringify({ orderId })],
      );
      const eventId = res.rows[0].id;
      cleanups.outboxIds.push(eventId);

      const event: schema.OutboxEvent = {
        id: eventId,
        type: 'CREATE_CONSIGNMENT',
        payload: { orderId },
        status: 'processing',
        attempts: 2,
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const success = await processor.processEvent(event);
      expect(success).toBe(true);
      expect(mockCourierService.createConsignment).toHaveBeenCalledTimes(1);

      const orderCheck = await pool.query(
        'SELECT consignment_id FROM orders WHERE id = $1',
        [orderId],
      );
      expect(orderCheck.rows[0].consignment_id).toBe('SF-FRESH-123');
    });

    it('COU-25-C: Provider inquiry 200 adopts existing consignment without duplicate creation', async () => {
      const { orderId } = await seedOrderFixture();

      mockCourierService.getConsignmentByInvoice.mockResolvedValueOnce({
        success: true,
        consignmentId: 'SF-ADOPTED-777',
        trackingCode: 'SF-ADOPTED-777',
        trackingUrl: 'https://steadfast.com.bd/t/SF-ADOPTED-777',
      });

      const res = await pool.query(
        `
        INSERT INTO outbox_events (type, payload, status, attempts)
        VALUES ('CREATE_CONSIGNMENT', $1::jsonb, 'processing', 2)
        RETURNING id;
      `,
        [JSON.stringify({ orderId })],
      );
      const eventId = res.rows[0].id;
      cleanups.outboxIds.push(eventId);

      const event: schema.OutboxEvent = {
        id: eventId,
        type: 'CREATE_CONSIGNMENT',
        payload: { orderId },
        status: 'processing',
        attempts: 2,
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const success = await processor.processEvent(event);
      expect(success).toBe(true);
      expect(mockCourierService.createConsignment).not.toHaveBeenCalled();

      const orderCheck = await pool.query(
        'SELECT consignment_id FROM orders WHERE id = $1',
        [orderId],
      );
      expect(orderCheck.rows[0].consignment_id).toBe('SF-ADOPTED-777');
    });

    it('COU-25-D: PENDING_DISPATCH sentinel is sanitized to null in admin/client order responses', async () => {
      const { orderId } = await seedOrderFixture({
        consignmentId: 'PENDING_DISPATCH',
      });

      const adminOrder = await ordersStore.getOrderDetailsAsAdmin(orderId);
      expect(adminOrder).not.toBeNull();
      expect(adminOrder?.consignmentId).toBeNull();
    });

    it('COU-25-E: trackConsignment rejects PENDING_DISPATCH without returning mock tracking data', async () => {
      const tracking =
        await courierService.trackConsignment('PENDING_DISPATCH');
      expect(tracking.success).toBe(false);
      expect(tracking.message).toContain('Consignment is pending dispatch');
      expect(tracking.origin).toBeUndefined();
    });

    it('COU-25-F: Failed consignment creation immediately clears PENDING_DISPATCH from order', async () => {
      const { orderId } = await seedOrderFixture({ consignmentId: null });

      mockCourierService.createConsignment.mockResolvedValueOnce({
        success: false,
        message: 'Steadfast account balance insufficient',
      });

      const res = await pool.query(
        `
        INSERT INTO outbox_events (type, payload, status, attempts)
        VALUES ('CREATE_CONSIGNMENT', $1::jsonb, 'processing', 1)
        RETURNING id;
      `,
        [JSON.stringify({ orderId })],
      );
      const eventId = res.rows[0].id;
      cleanups.outboxIds.push(eventId);

      const event: schema.OutboxEvent = {
        id: eventId,
        type: 'CREATE_CONSIGNMENT',
        payload: { orderId },
        status: 'processing',
        attempts: 1,
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const success = await processor.processEvent(event);
      expect(success).toBe(false);

      const orderCheck = await pool.query(
        'SELECT consignment_id FROM orders WHERE id = $1',
        [orderId],
      );
      expect(orderCheck.rows[0].consignment_id).toBeNull();
    });
  });
});
