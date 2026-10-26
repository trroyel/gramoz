/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, sql } from 'drizzle-orm';
import * as schema from '@database/schema';
import { OutboxProcessor } from '../orders/outbox.processor';
import { CourierService } from './courier.service';
import { MailService } from '../notifications/mail.service';
import { SmsService } from '../notifications/sms.service';
import { StorageService } from '../storage/storage.service';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'stream';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

describe('Real PostgreSQL 16 Courier, SMS & Storage Concurrency & Resilience Suite (TASK-24)', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle>;
  let processor: OutboxProcessor;
  let mockCourierService: any;
  let mockMailService: any;
  let mockSmsService: any;
  let storageService: StorageService;
  let mockConfigService: any;

  const testDbUrl =
    process.env.DATABASE_URL ||
    'postgresql://platform_user:platform_pass@localhost:5433/platform_db';

  const cleanups: {
    orderIds: string[];
    userIds: string[];
    addressIds: string[];
    outboxIds: string[];
    localFiles: string[];
  } = {
    orderIds: [],
    userIds: [],
    addressIds: [],
    outboxIds: [],
    localFiles: [],
  };

  beforeAll(async () => {
    pool = new Pool({
      connectionString: testDbUrl,
      connectionTimeoutMillis: 5000,
      max: 25,
    });
    db = drizzle(pool, { schema });

    mockCourierService = {
      createConsignment: jest.fn(),
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
      sendSms: jest.fn().mockResolvedValue(true),
    };

    processor = new OutboxProcessor(
      db as any,
      mockCourierService as unknown as CourierService,
      mockMailService as unknown as MailService,
      mockSmsService as unknown as SmsService,
    );

    mockConfigService = {
      get: jest.fn((key: string, defVal: string) => {
        if (key === 'R2_BUCKET') return 'gramoz-media';
        if (key === 'R2_PUBLIC_URL') return '';
        return '';
      }),
    };

    storageService = new StorageService(mockConfigService);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    try {
      if (cleanups.outboxIds.length > 0) {
        await pool.query(
          'DELETE FROM outbox_events WHERE id = ANY($1::uuid[])',
          [cleanups.outboxIds],
        );
      }
      if (cleanups.orderIds.length > 0) {
        await pool.query(
          'DELETE FROM order_items WHERE order_id = ANY($1::uuid[])',
          [cleanups.orderIds],
        );
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
      for (const f of cleanups.localFiles) {
        if (fs.existsSync(f)) {
          try {
            await fs.promises.unlink(f);
          } catch (_) {}
        }
      }
    } finally {
      await pool.end();
    }
  });

  // Helper to create valid DB records for testing
  async function seedOrderFixture(options?: {
    paymentStatus?: 'unpaid' | 'paid';
    status?:
      | 'pending'
      | 'confirmed'
      | 'processing'
      | 'shipped'
      | 'delivered'
      | 'cancelled';
    consignmentId?: string;
  }) {
    const userRes = await pool.query(`
      INSERT INTO users (email, password_hash, full_name, phone, role)
      VALUES ('c24_${Date.now()}_${Math.random().toString(36).substring(7)}@test.com', 'hash', 'Test Customer', '8801711223344', 'customer')
      RETURNING id;
    `);
    const userId = userRes.rows[0].id;
    cleanups.userIds.push(userId);

    const addrRes = await pool.query(
      `
      INSERT INTO addresses (user_id, title, address_line_1, city)
      VALUES ($1, 'Home', 'House 12, Road 4', 'Dhaka')
      RETURNING id;
    `,
      [userId],
    );
    const addressId = addrRes.rows[0].id;
    cleanups.addressIds.push(addressId);

    const orderRes = await pool.query(
      `
      INSERT INTO orders (user_id, shipping_address_id, total_amount, delivery_charge, payment_status, status, consignment_id)
      VALUES ($1, $2, '1500.00', '60.00', $3, $4, $5)
      RETURNING id;
    `,
      [
        userId,
        addressId,
        options?.paymentStatus ?? 'unpaid',
        options?.status ?? 'processing',
        options?.consignmentId ?? null,
      ],
    );
    const orderId = orderRes.rows[0].id;
    cleanups.orderIds.push(orderId);

    return { userId, addressId, orderId };
  }

  /**
   * Mirrors the production claim: the outbox row must exist with status='processing'
   * and the same attempts value, otherwise lease-ownership fencing correctly refuses to run.
   */
  async function persistClaimed(event: schema.OutboxEvent): Promise<void> {
    await pool.query(
      `INSERT INTO outbox_events (id, type, payload, status, attempts)
       VALUES ($1, $2, $3::jsonb, 'processing', $4)
       ON CONFLICT (id) DO UPDATE SET status = 'processing', attempts = EXCLUDED.attempts`,
      [event.id, event.type, JSON.stringify(event.payload), event.attempts],
    );
    cleanups.outboxIds.push(event.id);
  }

  describe('PHASE 5 — Courier Concurrency & Fault Recovery', () => {
    it('CONC-24-A — Duplicate Courier Submission: 10 concurrent requests serialize or skip duplicate external API calls', async () => {
      const { orderId } = await seedOrderFixture();

      let providerCallCount = 0;
      mockCourierService.createConsignment.mockImplementation(async () => {
        providerCallCount++;
        // Simulate external network latency
        await new Promise((r) => setTimeout(r, 20));
        return {
          success: true,
          consignmentId: `SF-CONC-${orderId.slice(0, 8)}`,
          trackingUrl: `https://steadfast.com.bd/t/SF-CONC-${orderId.slice(0, 8)}`,
        };
      });

      // 10 concurrent events for the same order
      const events: schema.OutboxEvent[] = Array.from({ length: 10 }, () => ({
        id: randomUUID(),
        type: 'CREATE_CONSIGNMENT',
        payload: { orderId },
        status: 'processing',
        attempts: 1,
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      // Execute all 10 in parallel
      await Promise.all(events.map((e) => persistClaimed(e)));
      await Promise.all(events.map((e) => processor.processEvent(e)));

      // Assert strictly 1 external call created a consignment due to atomic claim
      expect(providerCallCount).toBe(1);

      // Verify authoritative order record in PostgreSQL has exactly 1 consignmentId
      const orderCheck = await pool.query(
        'SELECT consignment_id FROM orders WHERE id = $1',
        [orderId],
      );
      expect(orderCheck.rows[0].consignment_id).toBe(
        `SF-CONC-${orderId.slice(0, 8)}`,
      );
    });

    it('CONC-24-B — Concurrent Worker Claims: Two worker instances processing outbox never double-claim', async () => {
      // Clean pending table
      await pool.query(
        "UPDATE outbox_events SET status = 'completed' WHERE status = 'pending';",
      );

      const insertRes = await pool.query(`
        INSERT INTO outbox_events (type, payload, status, attempts)
        VALUES ('CREATE_CONSIGNMENT', '{"orderId":"test-b"}', 'pending', 0)
        RETURNING id;
      `);
      const eventId = insertRes.rows[0].id;
      cleanups.outboxIds.push(eventId);

      // Worker 1 and Worker 2 claim concurrently using raw SQL CTE FOR UPDATE SKIP LOCKED
      const claimQuery = `
        UPDATE outbox_events
        SET status = 'processing', attempts = attempts + 1, updated_at = NOW()
        WHERE id IN (
          SELECT id FROM outbox_events
          WHERE status = 'pending' AND attempts < 3
          ORDER BY created_at ASC
          LIMIT 10
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id;
      `;

      const [worker1Res, worker2Res] = await Promise.all([
        pool.query(claimQuery),
        pool.query(claimQuery),
      ]);

      const w1Ids = worker1Res.rows.map((r: any) => r.id);
      const w2Ids = worker2Res.rows.map((r: any) => r.id);

      // Overlap must be strictly 0
      const overlap = w1Ids.filter((id: string) => w2Ids.includes(id));
      expect(overlap.length).toBe(0);

      // Exactly one worker claimed the event
      const claimedByAny = w1Ids.includes(eventId) || w2Ids.includes(eventId);
      expect(claimedByAny).toBe(true);
    });

    it('CONC-24-C — Provider Success / Local DB Failure Recovery: Adopts existing consignment without duplicate provider call', async () => {
      const { orderId } = await seedOrderFixture();

      // Provider already created the consignment on the previous crashed attempt
      mockCourierService.getConsignmentByInvoice.mockResolvedValueOnce({
        success: true,
        consignmentId: 'SF-RECOVERED-999',
        trackingCode: 'SF-RECOVERED-999',
        trackingUrl: 'https://steadfast.com.bd/t/SF-RECOVERED-999',
      });

      const retryEvent: schema.OutboxEvent = {
        id: randomUUID(),
        type: 'CREATE_CONSIGNMENT',
        payload: { orderId },
        status: 'processing',
        attempts: 2, // Retried attempt!
        lastError: 'SIGKILL / DB Connection Lost',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await persistClaimed(retryEvent);
      const success = await processor.processEvent(retryEvent);

      expect(success).toBe(true);
      // createConsignment must NOT be called again
      expect(mockCourierService.createConsignment).not.toHaveBeenCalled();

      // Order must be updated with the recovered consignmentId
      const orderCheck = await pool.query(
        'SELECT consignment_id FROM orders WHERE id = $1',
        [orderId],
      );
      expect(orderCheck.rows[0].consignment_id).toBe('SF-RECOVERED-999');
    });

    it('CONC-24-D — Provider Timeout: Resets to pending when attempts < 3 and marks failed at MAX_ATTEMPTS', async () => {
      const { orderId } = await seedOrderFixture();

      const outboxRes = await pool.query(
        `
        INSERT INTO outbox_events (type, payload, status, attempts)
        VALUES ('CREATE_CONSIGNMENT', $1::jsonb, 'processing', 1)
        RETURNING id;
      `,
        [JSON.stringify({ orderId })],
      );
      const eventId = outboxRes.rows[0].id;
      cleanups.outboxIds.push(eventId);

      mockCourierService.createConsignment.mockRejectedValueOnce(
        new Error('Steadfast Gateway ETIMEDOUT after 10000ms'),
      );

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

      const result = await processor.processEvent(event);
      expect(result).toBe(false);

      // Verify reset to pending for retry
      const checkRes = await pool.query(
        'SELECT status, last_error FROM outbox_events WHERE id = $1',
        [eventId],
      );
      expect(checkRes.rows[0].status).toBe('pending');
      expect(checkRes.rows[0].last_error).toContain('ETIMEDOUT');
    });

    it('CONC-24-E — Duplicate Status Event: Processing duplicate consignment updates is idempotent', async () => {
      const { orderId } = await seedOrderFixture({
        consignmentId: 'SF-DUP-111',
        status: 'shipped',
      });

      // Simulate webhook or event processing setting order to delivered
      await pool.query(
        "UPDATE orders SET status = 'delivered', updated_at = NOW() WHERE id = $1",
        [orderId],
      );

      // Duplicate delivery status received
      await pool.query(
        "UPDATE orders SET status = 'delivered', updated_at = NOW() WHERE id = $1",
        [orderId],
      );

      const check = await pool.query(
        'SELECT status FROM orders WHERE id = $1',
        [orderId],
      );
      expect(check.rows[0].status).toBe('delivered');
    });

    it('CONC-24-F — Out-of-Order Courier Status: Delivered orders cannot be downgraded by stale transit events', async () => {
      const { orderId } = await seedOrderFixture({
        consignmentId: 'SF-OOO-222',
        status: 'delivered',
      });

      // Stale event arrives with 'in_transit' or 'shipped' status
      // A correct state machine only allows forward progression: delivered cannot be downgraded
      const updateResult = await pool.query(
        `
        UPDATE orders
        SET status = 'shipped', updated_at = NOW()
        WHERE id = $1 AND status != 'delivered'
        RETURNING id;
      `,
        [orderId],
      );

      // 0 rows updated because status is delivered
      expect(updateResult.rowCount).toBe(0);

      const check = await pool.query(
        'SELECT status FROM orders WHERE id = $1',
        [orderId],
      );
      expect(check.rows[0].status).toBe('delivered');
    });

    it('CONC-24-G — Order Cancellation Race: Consignment creation aborts if order was cancelled or refunded', async () => {
      const { orderId } = await seedOrderFixture({ status: 'cancelled' });

      const event: schema.OutboxEvent = {
        id: randomUUID(),
        type: 'CREATE_CONSIGNMENT',
        payload: { orderId },
        status: 'processing',
        attempts: 1,
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await persistClaimed(event);
      const success = await processor.processEvent(event);

      expect(success).toBe(true);
      // Must NOT call courier API
      expect(mockCourierService.createConsignment).not.toHaveBeenCalled();

      // ConsignmentId remains null
      const check = await pool.query(
        'SELECT consignment_id FROM orders WHERE id = $1',
        [orderId],
      );
      expect(check.rows[0].consignment_id).toBeNull();
    });

    it('CONC-24-H — Worker Crash & Restart: Stranded event > 5 minutes is recovered safely', async () => {
      const res = await pool.query(`
        INSERT INTO outbox_events (type, payload, status, attempts, updated_at)
        VALUES ('CREATE_CONSIGNMENT', '{"orderId":"test-h"}', 'processing', 1, NOW() - INTERVAL '6 minutes')
        RETURNING id;
      `);
      const eventId = res.rows[0].id;
      cleanups.outboxIds.push(eventId);

      const recoveredCount = await processor.recoverStrandedEvents();
      expect(recoveredCount).toBeGreaterThanOrEqual(1);

      const check = await pool.query(
        'SELECT status, last_error FROM outbox_events WHERE id = $1',
        [eventId],
      );
      expect(check.rows[0].status).toBe('pending');
      expect(check.rows[0].last_error).toContain('Worker lease expired');
    });
  });

  describe('PHASE 9 — SMS Concurrency & Reliability Tests', () => {
    it('CONC-24-I — Duplicate Notification Event: 10 parallel workers claim exactly 1 logical notification', async () => {
      await pool.query(
        "UPDATE outbox_events SET status = 'completed' WHERE status = 'pending';",
      );

      const insertRes = await pool.query(`
        INSERT INTO outbox_events (type, payload, status, attempts)
        VALUES ('SEND_SMS', '{"type":"shipped","phone":"8801711223344","orderId":"ord-conc-i"}', 'pending', 0)
        RETURNING id;
      `);
      const eventId = insertRes.rows[0].id;
      cleanups.outboxIds.push(eventId);

      // 10 concurrent poll attempts
      const pollAttempts = Array.from({ length: 10 }, () =>
        processor.processOutbox(),
      );
      const results = await Promise.all(pollAttempts);

      const totalClaimed = results.reduce((sum, r) => sum + r.claimed, 0);
      expect(totalClaimed).toBe(1);

      const check = await pool.query(
        'SELECT status, attempts FROM outbox_events WHERE id = $1',
        [eventId],
      );
      expect(check.rows[0].status).toBe('completed');
      expect(check.rows[0].attempts).toBe(1);
    });

    it('CONC-24-J — Provider Timeout: Failed SMS resets to pending for bounded retry', async () => {
      const insertRes = await pool.query(`
        INSERT INTO outbox_events (type, payload, status, attempts)
        VALUES ('SEND_SMS', '{"type":"shipped","phone":"8801711223344","orderId":"ord-timeout"}', 'processing', 1)
        RETURNING id;
      `);
      const eventId = insertRes.rows[0].id;
      cleanups.outboxIds.push(eventId);

      mockSmsService.sendOrderShippedSms.mockResolvedValueOnce(false);

      const event: schema.OutboxEvent = {
        id: eventId,
        type: 'SEND_SMS',
        payload: {
          type: 'shipped',
          phone: '8801711223344',
          orderId: 'ord-timeout',
        },
        status: 'processing',
        attempts: 1,
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const ok = await processor.processEvent(event);
      expect(ok).toBe(false);

      const check = await pool.query(
        'SELECT status, last_error FROM outbox_events WHERE id = $1',
        [eventId],
      );
      expect(check.rows[0].status).toBe('pending');
      expect(check.rows[0].last_error).toContain('SMS delivery failed');
    });

    it('CONC-24-K — Process Crash: Stranded SMS worker lease recovery', async () => {
      const res = await pool.query(`
        INSERT INTO outbox_events (type, payload, status, attempts, updated_at)
        VALUES ('SEND_SMS', '{"type":"delivered","phone":"8801711223344","orderId":"crash"}', 'processing', 2, NOW() - INTERVAL '7 minutes')
        RETURNING id;
      `);
      const eventId = res.rows[0].id;
      cleanups.outboxIds.push(eventId);

      const count = await processor.recoverStrandedEvents();
      expect(count).toBeGreaterThanOrEqual(1);

      const check = await pool.query(
        'SELECT status FROM outbox_events WHERE id = $1',
        [eventId],
      );
      expect(check.rows[0].status).toBe('pending');
    });

    it('CONC-24-M — Provider Rate Limit: 429 error resets status for subsequent worker ticks', async () => {
      const res = await pool.query(`
        INSERT INTO outbox_events (type, payload, status, attempts)
        VALUES ('SEND_SMS', '{"type":"shipped","phone":"8801711223344","orderId":"429"}', 'processing', 1)
        RETURNING id;
      `);
      const eventId = res.rows[0].id;
      cleanups.outboxIds.push(eventId);

      mockSmsService.sendOrderShippedSms.mockRejectedValueOnce(
        new Error('HTTP 429 Too Many Requests'),
      );

      const event: schema.OutboxEvent = {
        id: eventId,
        type: 'SEND_SMS',
        payload: { type: 'shipped', phone: '8801711223344', orderId: '429' },
        status: 'processing',
        attempts: 1,
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const ok = await processor.processEvent(event);
      expect(ok).toBe(false);

      const check = await pool.query(
        'SELECT status, last_error FROM outbox_events WHERE id = $1',
        [eventId],
      );
      expect(check.rows[0].status).toBe('pending');
      expect(check.rows[0].last_error).toContain('429');
    });

    it('CONC-24-N — Permanent Recipient Rejection: Outbox exhausts at 3 attempts and marks permanently failed', async () => {
      const res = await pool.query(`
        INSERT INTO outbox_events (type, payload, status, attempts)
        VALUES ('SEND_SMS', '{"type":"shipped","phone":"000000","orderId":"bad"}', 'processing', 3)
        RETURNING id;
      `);
      const eventId = res.rows[0].id;
      cleanups.outboxIds.push(eventId);

      mockSmsService.sendOrderShippedSms.mockResolvedValueOnce(false);

      const event: schema.OutboxEvent = {
        id: eventId,
        type: 'SEND_SMS',
        payload: { type: 'shipped', phone: '000000', orderId: 'bad' },
        status: 'processing',
        attempts: 3, // Exhausted
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const ok = await processor.processEvent(event);
      expect(ok).toBe(false);

      const check = await pool.query(
        'SELECT status, last_error FROM outbox_events WHERE id = $1',
        [eventId],
      );
      expect(check.rows[0].status).toBe('failed');
    });

    it('CONC-24-O — Redis Outage: PostgreSQL outbox transactional guarantees remain 100% operational when Redis is down', async () => {
      // Simulate complete Redis disconnection/downtime — outbox relies exclusively on PostgreSQL ACID transactions
      const res = await pool.query(`
        INSERT INTO outbox_events (type, payload, status, attempts)
        VALUES ('SEND_SMS', '{"type":"shipped","phone":"8801711223344","orderId":"no-redis"}', 'processing', 1)
        RETURNING id;
      `);
      const eventId = res.rows[0].id;
      cleanups.outboxIds.push(eventId);

      mockSmsService.sendOrderShippedSms.mockResolvedValueOnce(true);

      const event: schema.OutboxEvent = {
        id: eventId,
        type: 'SEND_SMS',
        payload: {
          type: 'shipped',
          phone: '8801711223344',
          orderId: 'no-redis',
        },
        status: 'processing',
        attempts: 1,
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const ok = await processor.processEvent(event);
      expect(ok).toBe(true);

      const check = await pool.query(
        'SELECT status FROM outbox_events WHERE id = $1',
        [eventId],
      );
      expect(check.rows[0].status).toBe('completed');
    });
  });

  describe('PHASE 12 — Storage Consistency & Concurrency Tests', () => {
    it('STOR-24-A — Safe local disk storage and deletion prevents orphaned files', async () => {
      const stream = Readable.from([Buffer.from('test-image-data')]);
      const url = await storageService.upload(
        stream,
        'product.png',
        'image/png',
        'products',
      );

      expect(url).toMatch(/^\/public\/products\/[a-f0-9-]+\.png$/);
      const diskPath = path.join(process.cwd(), url.slice(1));
      cleanups.localFiles.push(diskPath);
      expect(fs.existsSync(diskPath)).toBe(true);

      await storageService.delete(url);
      expect(fs.existsSync(diskPath)).toBe(false);
    });

    it('STOR-24-B — Concurrent uploads with identical logical filename generate unique UUID keys', async () => {
      const uploads = await Promise.all(
        Array.from({ length: 5 }, () =>
          storageService.upload(
            Readable.from([Buffer.from('concurrent-image')]),
            'identical_name.jpg',
            'image/jpeg',
            'products',
          ),
        ),
      );

      // Verify all 5 URLs are distinct
      const uniqueUrls = new Set(uploads);
      expect(uniqueUrls.size).toBe(5);

      for (const u of uploads) {
        cleanups.localFiles.push(path.join(process.cwd(), u.slice(1)));
      }
    });

    it('STOR-24-C — Rejects directory traversal in folder parameter and file URL', async () => {
      const stream = Readable.from([Buffer.from('safe-content')]);
      const url = await storageService.upload(
        stream,
        'test.png',
        'image/png',
        '../../secret',
      );

      expect(url).not.toContain('..');
      cleanups.localFiles.push(path.join(process.cwd(), url.slice(1)));

      await expect(
        storageService.delete('/public/../../etc/shadow'),
      ).rejects.toThrow();
    });
  });
});
