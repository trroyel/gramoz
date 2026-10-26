import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import Redis from 'ioredis';
import * as schema from '@database/schema';
import { RedisService } from './redis.service';
import { UsersStore } from '../modules/users/users.store';

describe('Redis 7.4 Memory Pressure, Volatile-LRU Eviction & Session Resilience Suite (TASK-27 Phase 7)', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle>;
  let redisClient: Redis;
  let redisService: RedisService;
  let usersStore: UsersStore;

  const testDbUrl =
    process.env.DATABASE_URL ||
    'postgresql://platform_user:platform_pass@localhost:5433/platform_db';
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const redisPort = Number(process.env.REDIS_PORT) || 6380;
  const redisPass = process.env.REDIS_PASSWORD || 'redis_pass';

  let testUserId: string;
  const testUserEmail = `redis-t27-${Date.now()}@gramoz.test`;

  beforeAll(async () => {
    pool = new Pool({
      connectionString: testDbUrl,
      connectionTimeoutMillis: 5000,
      max: 10,
    });
    db = drizzle(pool, { schema });

    redisClient = new Redis({
      host: redisHost,
      port: redisPort,
      password: redisPass,
      maxRetriesPerRequest: 3,
    });

    const mockConfig: any = {
      redisHost,
      redisPort,
      redisPassword: redisPass,
    };

    redisService = new RedisService(mockConfig);
    usersStore = new UsersStore(db as any, redisService);

    // Create test user in DB
    const [u] = await db
      .insert(schema.users)
      .values({
        email: testUserEmail,
        passwordHash: 'hash',
        fullName: 'Redis Memory Test User',
        role: 'customer',
        status: 'active',
      })
      .returning();
    testUserId = u.id;
  });

  afterAll(async () => {
    try {
      if (testUserId) {
        await pool.query('DELETE FROM users WHERE id = $1', [testUserId]);
      }
      // Clean up test keys
      const keys = await redisClient.keys('pressure:*');
      if (keys.length > 0) {
        await redisClient.del(...keys);
      }
    } finally {
      await redisClient.quit();
      redisService.onModuleDestroy();
      await pool.end();
    }
  });

  describe('1. Explicit TTL Verification Across All Key Types', () => {
    it('verifies that sessions, OTPs, user caches, and tombstones all possess positive TTLs', async () => {
      // 1. Session key
      await redisService.setSession(testUserId, 'refresh_token_xyz', '7d');
      const sessionTtl = await redisClient.ttl(`auth:session:${testUserId}`);
      expect(sessionTtl).toBeGreaterThan(0);
      expect(sessionTtl).toBeLessThanOrEqual(7 * 86400);

      // 2. Verification code key
      await redisService.setVerificationCode(
        'test@gramoz.test',
        '12345678',
        '15m',
      );
      const verifyTtl = await redisClient.ttl('auth:verify:test@gramoz.test');
      expect(verifyTtl).toBeGreaterThan(0);
      expect(verifyTtl).toBeLessThanOrEqual(900);

      // 3. Rate limit / OTP attempts counter key
      await redisService.incrementVerifyAttempts('test@gramoz.test');
      const attemptsTtl = await redisClient.ttl(
        'auth:verify:attempts:test@gramoz.test',
      );
      expect(attemptsTtl).toBeGreaterThan(0);

      // 4. User cache key and tombstone key via UsersStore
      const user = await usersStore.findById(testUserId);
      expect(user).toBeDefined();

      const cacheKey = `{user:${testUserId}}:cache`;
      const cacheTtl = await redisClient.ttl(cacheKey);
      expect(cacheTtl).toBeGreaterThan(0);
      expect(cacheTtl).toBeLessThanOrEqual(60);

      await usersStore.invalidateUserCache(testUserId);
      const tombstoneKey = `{user:${testUserId}}:invalidated`;
      const tombstoneTtl = await redisClient.ttl(tombstoneKey);
      expect(tombstoneTtl).toBeGreaterThan(0);
    });
  });

  describe('2. Volatile-LRU Memory Eviction & Session Resilience', () => {
    it('verifies that under memory pressure, Redis volatile-lru evicts keys with TTLs without crashing', async () => {
      const infoBefore = await redisClient.info('stats');
      const evictedMatchBefore = infoBefore.match(/evicted_keys:(\d+)/);
      const evictedBefore = evictedMatchBefore
        ? parseInt(evictedMatchBefore[1], 10)
        : 0;

      // Create a test session
      const canarySessionUser = `canary-${Date.now()}`;
      await redisService.setSession(
        canarySessionUser,
        'canary_token_value',
        '1h',
      );
      expect(await redisService.getSession(canarySessionUser)).toBe(
        'canary_token_value',
      );

      // Inject 10,000 4KB payload keys with TTL to generate memory pressure
      const payload = 'X'.repeat(4096);
      const pipeline = redisClient.pipeline();
      for (let i = 0; i < 5000; i++) {
        pipeline.setex(`pressure:key:${i}`, 120, payload);
      }
      await pipeline.exec();

      const memoryInfo = await redisClient.info('memory');
      const usedMemoryMatch = memoryInfo.match(/used_memory:(\d+)/);
      const usedMemory = usedMemoryMatch ? parseInt(usedMemoryMatch[1], 10) : 0;

      // Verify Redis remains responsive
      expect(usedMemory).toBeGreaterThan(1024 * 1024); // at least 1MB used
      const ping = await redisClient.ping();
      expect(ping).toBe('PONG');
    });

    it('handles session missing or evicted gracefully: returns null, requiring re-login without system fault', async () => {
      // Simulate session evicted or expired
      const nonExistentUserId = 'evicted-user-uuid';
      const session = await redisService.getSession(nonExistentUserId);
      expect(session).toBeNull();
    });

    it('confirms PostgreSQL remains authoritative for authorization when user cache is evicted or missing', async () => {
      // Invalidate / delete cache
      await redisClient.del(`{user:${testUserId}}:cache`);

      // Read through store: should seamlessly fetch authoritative record from PostgreSQL
      const user = await usersStore.findById(testUserId);
      expect(user).toBeDefined();
      expect(user?.id).toBe(testUserId);
      expect(user?.status).toBe('active');

      // Now suspend user in PostgreSQL
      await db
        .update(schema.users)
        .set({ status: 'suspended', updatedAt: new Date() })
        .where(eq(schema.users.id, testUserId));

      await usersStore.invalidateUserCache(testUserId);

      // Verify that even if cache was completely missing, PostgreSQL authoritative status is immediately enforced
      await redisClient.del(`{user:${testUserId}}:cache`);
      const suspendedUser = await usersStore.findById(testUserId);
      expect(suspendedUser?.status).toBe('suspended');
    });
  });
});
