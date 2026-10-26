/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/require-await */
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import * as schema from '@database/schema';
import { OutboxProcessor } from './outbox.processor';
import { CourierService } from '../courier/courier.service';
import { MailService } from '../notifications/mail.service';
import { SmsService } from '../notifications/sms.service';

describe('Transactional Outbox Concurrency, Partial Index & Stranded Recovery (PostgreSQL 16 Integration — TASK-12)', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle>;
  let processor: OutboxProcessor;
  let mockCourierService: any;
  let mockMailService: any;
  let mockSmsService: any;

  const testDbUrl =
    process.env.DATABASE_URL ||
    'postgresql://platform_user:platform_pass@localhost:5433/platform_db';

  const createdEventIds: string[] = [];

  beforeAll(async () => {
    pool = new Pool({
      connectionString: testDbUrl,
      connectionTimeoutMillis: 5000,
      max: 20,
    });
    db = drizzle(pool, { schema });

    mockCourierService = {
      createConsignment: jest.fn().mockResolvedValue({
        success: true,
        consignmentId: 'TEST-STEADFAST-101',
        trackingUrl: 'https://steadfast.com.bd/track/TEST-101',
      }),
    };

    mockMailService = {
      sendOrderConfirmation: jest.fn().mockResolvedValue(undefined),
      sendLowStockAlert: jest.fn().mockResolvedValue(undefined),
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
  });

  afterAll(async () => {
    try {
      if (createdEventIds.length > 0) {
        await pool.query(
          'DELETE FROM outbox_events WHERE id = ANY($1::uuid[])',
          [createdEventIds],
        );
      }
    } finally {
      await pool.end();
    }
  });

  describe('1. Partial Index Existence & Predicate Verification', () => {
    it('verifies outbox_events_pending_idx exists in PostgreSQL pg_indexes with exact partial predicate', async () => {
      const res = await pool.query(`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE tablename = 'outbox_events'
          AND indexname = 'outbox_events_pending_idx';
      `);

      expect(res.rows.length).toBe(1);
      const { indexname, indexdef } = res.rows[0];
      expect(indexname).toBe('outbox_events_pending_idx');
      expect(indexdef).toContain('WHERE');
      expect(indexdef).toContain("status = 'pending'::outbox_status");
      expect(indexdef).toContain('attempts < 3');
    });

    it('verifies outbox_events_processing_idx exists in PostgreSQL pg_indexes for crash recovery', async () => {
      const res = await pool.query(`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE tablename = 'outbox_events'
          AND indexname = 'outbox_events_processing_idx';
      `);

      expect(res.rows.length).toBe(1);
      const { indexname, indexdef } = res.rows[0];
      expect(indexname).toBe('outbox_events_processing_idx');
      expect(indexdef).toContain(
        "WHERE (status = 'processing'::outbox_status)",
      );
    });

    it('verifies EXPLAIN (ANALYZE, BUFFERS) selects outbox_events_pending_idx with zero sequential scans', async () => {
      const explainRes = await pool.query(`
        EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
        SELECT id
        FROM   outbox_events
        WHERE  status   = 'pending'
          AND  attempts < 3
        ORDER  BY created_at ASC
        LIMIT  10
        FOR UPDATE SKIP LOCKED;
      `);

      const planJson = explainRes.rows[0]['QUERY PLAN'][0];
      const planStr = JSON.stringify(planJson);

      expect(planStr).toContain('outbox_events_pending_idx');
      expect(planStr).not.toContain('"Node Type": "Seq Scan"');
    });
  });

  describe('2. Transactional Event Creation & Atomic Rollback', () => {
    it('commits outbox event atomically within a successful transaction', async () => {
      const client = await pool.connect();
      let eventId: string;
      try {
        await client.query('BEGIN');
        const insertRes = await client.query(`
          INSERT INTO outbox_events (type, payload, status, attempts)
          VALUES ('SEND_ORDER_CONFIRMATION', '{"orderId":"tx-success-1"}'::jsonb, 'pending', 0)
          RETURNING id;
        `);
        eventId = insertRes.rows[0].id;
        createdEventIds.push(eventId);
        await client.query('COMMIT');
      } finally {
        client.release();
      }

      const check = await pool.query(
        'SELECT * FROM outbox_events WHERE id = $1',
        [eventId],
      );
      expect(check.rows.length).toBe(1);
      expect(check.rows[0].status).toBe('pending');
    });

    it('aborts outbox event insertion completely if transaction rolls back', async () => {
      const client = await pool.connect();
      let rolledBackId: string | null = null;
      try {
        await client.query('BEGIN');
        const insertRes = await client.query(`
          INSERT INTO outbox_events (type, payload, status, attempts)
          VALUES ('SEND_ORDER_CONFIRMATION', '{"orderId":"tx-abort-1"}'::jsonb, 'pending', 0)
          RETURNING id;
        `);
        rolledBackId = insertRes.rows[0].id;
        // Simulate error leading to ROLLBACK
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }

      const check = await pool.query(
        'SELECT * FROM outbox_events WHERE id = $1',
        [rolledBackId],
      );
      expect(check.rows.length).toBe(0);
    });
  });

  describe('3. Ordering, Predicate Selectivity & Exclusion of Non-Pending Events', () => {
    it('retrieves pending events in strict FIFO order (created_at ASC)', async () => {
      const now = Date.now();
      const res1 = await pool.query(
        `
        INSERT INTO outbox_events (type, payload, status, attempts, created_at)
        VALUES ('SEND_ORDER_CONFIRMATION', '{"seq":1}'::jsonb, 'pending', 0, $1)
        RETURNING id;
      `,
        [new Date(now - 30000)],
      );
      const res2 = await pool.query(
        `
        INSERT INTO outbox_events (type, payload, status, attempts, created_at)
        VALUES ('SEND_ORDER_CONFIRMATION', '{"seq":2}'::jsonb, 'pending', 0, $1)
        RETURNING id;
      `,
        [new Date(now - 20000)],
      );
      const res3 = await pool.query(
        `
        INSERT INTO outbox_events (type, payload, status, attempts, created_at)
        VALUES ('SEND_ORDER_CONFIRMATION', '{"seq":3}'::jsonb, 'pending', 0, $1)
        RETURNING id;
      `,
        [new Date(now - 10000)],
      );

      const id1 = res1.rows[0].id;
      const id2 = res2.rows[0].id;
      const id3 = res3.rows[0].id;
      createdEventIds.push(id1, id2, id3);

      const queryRes = await pool.query(
        `
        SELECT id
        FROM   outbox_events
        WHERE  status = 'pending' AND attempts < 3
          AND  id = ANY($1::uuid[])
        ORDER  BY created_at ASC;
      `,
        [[id1, id2, id3]],
      );

      expect(queryRes.rows.map((r) => r.id)).toEqual([id1, id2, id3]);
    });

    it('excludes completed and retry-exhausted (attempts >= 3) events from pending query', async () => {
      const resComp = await pool.query(`
        INSERT INTO outbox_events (type, payload, status, attempts)
        VALUES ('SEND_ORDER_CONFIRMATION', '{"status":"completed"}'::jsonb, 'completed', 1)
        RETURNING id;
      `);
      const resExhaust = await pool.query(`
        INSERT INTO outbox_events (type, payload, status, attempts)
        VALUES ('SEND_ORDER_CONFIRMATION', '{"status":"exhausted"}'::jsonb, 'pending', 3)
        RETURNING id;
      `);
      const idComp = resComp.rows[0].id;
      const idExhaust = resExhaust.rows[0].id;
      createdEventIds.push(idComp, idExhaust);

      const queryRes = await pool.query(
        `
        SELECT id
        FROM   outbox_events
        WHERE  status = 'pending' AND attempts < 3
          AND  id = ANY($1::uuid[]);
      `,
        [[idComp, idExhaust]],
      );

      expect(queryRes.rows.length).toBe(0);
    });
  });

  describe('4. Worker Processing State Transitions & Retry Handling', () => {
    it('transitions event from pending -> processing -> completed on success', async () => {
      const res = await pool.query(`
        INSERT INTO outbox_events (type, payload, status, attempts)
        VALUES ('SEND_ORDER_CONFIRMATION', '{"email":"test@example.com","fullName":"T","orderId":"o-1","items":[],"totalAmount":"100"}'::jsonb, 'processing', 1)
        RETURNING id;
      `);
      const eventId = res.rows[0].id;
      createdEventIds.push(eventId);

      // Fetch row
      const [event] = await db
        .select()
        .from(schema.outboxEvents)
        .where(eq(schema.outboxEvents.id, eventId));

      const success = await processor.processEvent(event);
      expect(success).toBe(true);

      const check = await pool.query(
        'SELECT status, attempts, last_error FROM outbox_events WHERE id = $1',
        [eventId],
      );
      expect(check.rows[0].status).toBe('completed');
      expect(check.rows[0].last_error).toBeNull();
    });

    it('resets event to pending with last_error when provider fails with attempts < 3', async () => {
      const res = await pool.query(`
        INSERT INTO outbox_events (type, payload, status, attempts)
        VALUES ('SEND_ORDER_CONFIRMATION', '{"email":"test@example.com","fullName":"T","orderId":"o-2","items":[],"totalAmount":"100"}'::jsonb, 'processing', 1)
        RETURNING id;
      `);
      const eventId = res.rows[0].id;
      createdEventIds.push(eventId);

      mockMailService.sendOrderConfirmation.mockRejectedValueOnce(
        new Error('Transient Mailgun Error 503 Service Unavailable'),
      );

      const [event] = await db
        .select()
        .from(schema.outboxEvents)
        .where(eq(schema.outboxEvents.id, eventId));
      const success = await processor.processEvent(event);
      expect(success).toBe(false);

      const check = await pool.query(
        'SELECT status, attempts, last_error FROM outbox_events WHERE id = $1',
        [eventId],
      );
      expect(check.rows[0].status).toBe('pending');
      expect(check.rows[0].attempts).toBe(1);
      expect(check.rows[0].last_error).toContain('Transient Mailgun Error 503');
    });

    it('permanently marks event as failed when attempts reaches MAX_ATTEMPTS (3)', async () => {
      const res = await pool.query(`
        INSERT INTO outbox_events (type, payload, status, attempts)
        VALUES ('SEND_ORDER_CONFIRMATION', '{"email":"test@example.com","fullName":"T","orderId":"o-3","items":[],"totalAmount":"100"}'::jsonb, 'processing', 3)
        RETURNING id;
      `);
      const eventId = res.rows[0].id;
      createdEventIds.push(eventId);

      mockMailService.sendOrderConfirmation.mockRejectedValueOnce(
        new Error('Fatal SMTP 550 Mailbox not found'),
      );

      const [event] = await db
        .select()
        .from(schema.outboxEvents)
        .where(eq(schema.outboxEvents.id, eventId));
      const success = await processor.processEvent(event);
      expect(success).toBe(false);

      const check = await pool.query(
        'SELECT status, attempts, last_error FROM outbox_events WHERE id = $1',
        [eventId],
      );
      expect(check.rows[0].status).toBe('failed');
      expect(check.rows[0].attempts).toBe(3);
      expect(check.rows[0].last_error).toContain(
        'Fatal SMTP 550 Mailbox not found',
      );
    });
  });

  describe('5. Stranded Worker Recovery (Lease Expiration)', () => {
    it('recovers events stuck in processing for > 5 minutes and resets to pending if attempts < 3', async () => {
      const res = await pool.query(`
        INSERT INTO outbox_events (type, payload, status, attempts, updated_at)
        VALUES ('SEND_ORDER_CONFIRMATION', '{"orderId":"stranded-1"}'::jsonb, 'processing', 1, NOW() - INTERVAL '6 minutes')
        RETURNING id;
      `);
      const eventId = res.rows[0].id;
      createdEventIds.push(eventId);

      const recoveredCount = await processor.recoverStrandedEvents();
      expect(recoveredCount).toBeGreaterThanOrEqual(1);

      const check = await pool.query(
        'SELECT status, attempts, last_error FROM outbox_events WHERE id = $1',
        [eventId],
      );
      expect(check.rows[0].status).toBe('pending');
      expect(check.rows[0].last_error).toContain('Worker lease expired');
    });

    it('marks stranded events as failed if attempts >= 3', async () => {
      const res = await pool.query(`
        INSERT INTO outbox_events (type, payload, status, attempts, updated_at)
        VALUES ('SEND_ORDER_CONFIRMATION', '{"orderId":"stranded-exhausted"}'::jsonb, 'processing', 3, NOW() - INTERVAL '10 minutes')
        RETURNING id;
      `);
      const eventId = res.rows[0].id;
      createdEventIds.push(eventId);

      await processor.recoverStrandedEvents();

      const check = await pool.query(
        'SELECT status, attempts, last_error FROM outbox_events WHERE id = $1',
        [eventId],
      );
      expect(check.rows[0].status).toBe('failed');
      expect(check.rows[0].last_error).toContain('Worker lease expired');
    });

    it('leaves actively processing events (< 5 minutes old) untouched', async () => {
      const res = await pool.query(`
        INSERT INTO outbox_events (type, payload, status, attempts, updated_at)
        VALUES ('SEND_ORDER_CONFIRMATION', '{"orderId":"active-processing"}'::jsonb, 'processing', 1, NOW() - INTERVAL '10 seconds')
        RETURNING id;
      `);
      const eventId = res.rows[0].id;
      createdEventIds.push(eventId);

      await processor.recoverStrandedEvents();

      const check = await pool.query(
        'SELECT status FROM outbox_events WHERE id = $1',
        [eventId],
      );
      expect(check.rows[0].status).toBe('processing');
    });
  });

  describe('6. High-Concurrency Polling & FOR UPDATE SKIP LOCKED Verification', () => {
    it('concurrent workers never claim the same event simultaneously (0 overlap)', async () => {
      const batchIds: string[] = [];
      for (let i = 0; i < 20; i++) {
        const res = await pool.query(
          `
          INSERT INTO outbox_events (type, payload, status, attempts, created_at)
          VALUES ('SEND_ORDER_CONFIRMATION', $1::jsonb, 'pending', 0, NOW() + ($2 || ' milliseconds')::interval)
          RETURNING id;
        `,
          [JSON.stringify({ seq: i, email: `c${i}@test.com` }), i * 10],
        );
        batchIds.push(res.rows[0].id);
      }
      createdEventIds.push(...batchIds);

      // Atomic claim function simulating independent worker process
      const claimWorkerBatch = async (): Promise<string[]> => {
        const client = await pool.connect();
        try {
          const res = await client.query(
            `
            UPDATE outbox_events
            SET
              status     = 'processing',
              attempts   = attempts + 1,
              updated_at = NOW()
            WHERE id IN (
              SELECT id
              FROM   outbox_events
              WHERE  status   = 'pending'
                AND  attempts < 3
                AND  id = ANY($1::uuid[])
              ORDER  BY created_at ASC
              LIMIT  10
              FOR UPDATE SKIP LOCKED
            )
            RETURNING id;
          `,
            [batchIds],
          );
          return res.rows.map((r) => r.id);
        } finally {
          client.release();
        }
      };

      // Run 3 concurrent worker polls simultaneously
      const [worker1Claimed, worker2Claimed, worker3Claimed] =
        await Promise.all([
          claimWorkerBatch(),
          claimWorkerBatch(),
          claimWorkerBatch(),
        ]);

      const totalClaimed = [
        ...worker1Claimed,
        ...worker2Claimed,
        ...worker3Claimed,
      ];
      const uniqueClaimed = new Set(totalClaimed);

      // Invariant 1: No duplicate claims (Zero overlap between workers)
      expect(uniqueClaimed.size).toBe(totalClaimed.length);

      // Invariant 2: All 20 items claimed across workers
      expect(totalClaimed.length).toBe(20);
      expect(uniqueClaimed.size).toBe(20);

      // Invariant 3: Each worker claimed at most limit (10)
      expect(worker1Claimed.length).toBeLessThanOrEqual(10);
      expect(worker2Claimed.length).toBeLessThanOrEqual(10);
      expect(worker3Claimed.length).toBeLessThanOrEqual(10);

      // Invariant 4: Database status for all claimed items is 'processing' and attempts is 1
      const dbRows = await pool.query(
        'SELECT id, status, attempts FROM outbox_events WHERE id = ANY($1::uuid[])',
        [batchIds],
      );
      for (const row of dbRows.rows) {
        expect(row.status).toBe('processing');
        expect(row.attempts).toBe(1);
      }
    });

    it('handles concurrent inserts during worker polling without deadlock or failure', async () => {
      // Drain any unowned pending outbox events from other test suites to ensure clean test isolation
      await pool.query(
        "UPDATE outbox_events SET status = 'completed' WHERE status = 'pending';",
      );

      const insertPromises = Array.from({ length: 15 }, async (_, i) => {
        const res = await pool.query(
          `
          INSERT INTO outbox_events (type, payload, status, attempts)
          VALUES ('SEND_SMS', $1::jsonb, 'pending', 0)
          RETURNING id;
        `,
          [
            JSON.stringify({
              index: i,
              type: 'shipped',
              phone: '01711111111',
              orderId: `ord-${i}`,
            }),
          ],
        );
        createdEventIds.push(res.rows[0].id);
        return res.rows[0].id;
      });

      const workerPoll = processor.processOutbox();

      const [insertedIds, pollResult] = await Promise.all([
        Promise.all(insertPromises),
        workerPoll,
      ]);

      expect(insertedIds.length).toBe(15);
      expect(pollResult.claimed).toBeGreaterThanOrEqual(0);
      expect(pollResult.completed).toBe(pollResult.claimed);
    });
  });
});
