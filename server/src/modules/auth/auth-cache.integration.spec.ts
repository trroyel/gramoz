/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import Redis from 'ioredis';
import {
  UnauthorizedException,
  ForbiddenException,
  ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as schema from '@database/schema';
import { UsersStore } from '@modules/users/users.store';
import { RedisService } from '@cache/redis.service';
import { ConfigService } from '@config/config.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { RolesGuard } from './guards/roles.guard';
import { ROLES_KEY } from './decorators/roles.decorator';

describe('Auth & Redis Caching (Real PostgreSQL & Redis Integration — TASK-09 / TASK-09S)', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle>;
  let redisClient: Redis;
  let redisService: RedisService;
  let usersStore: UsersStore;
  let jwtStrategy: JwtStrategy;

  const testDbUrl =
    process.env.DATABASE_URL ||
    'postgresql://platform_user:platform_pass@localhost:5433/platform_db';
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const redisPort = Number(process.env.REDIS_PORT) || 6380;
  const redisPass = process.env.REDIS_PASSWORD || 'redis_pass';

  let testUserId: string;
  const testUserEmail = `task09-test-${Date.now()}@gramoz.com`;

  beforeAll(async () => {
    // 1. Connect real PostgreSQL
    pool = new Pool({
      connectionString: testDbUrl,
      connectionTimeoutMillis: 5000,
      max: 10,
    });
    db = drizzle(pool, { schema });

    // 2. Connect real Redis
    redisClient = new Redis({
      host: redisHost,
      port: redisPort,
      password: redisPass,
      maxRetriesPerRequest: 3,
    });

    const mockConfig = {
      redisHost,
      redisPort,
      redisPassword: redisPass,
      jwtSecret: 'test-jwt-secret-task-09-production-verification',
    } as unknown as ConfigService;

    // Use a lightweight wrapper exposing real Redis
    redisService = {
      getClient: () => redisClient,
      get: (key: string) => redisClient.get(key),
      set: (key: string, val: string, ttl: number) =>
        redisClient.setex(key, ttl, val),
      del: (key: string) => redisClient.del(key),
    } as unknown as RedisService;

    usersStore = new UsersStore(db as any, redisService);
    jwtStrategy = new JwtStrategy(mockConfig, usersStore);

    // 3. Seed real user in PostgreSQL
    const [created] = await db
      .insert(schema.users)
      .values({
        email: testUserEmail,
        fullName: 'TASK-09 Integration User',
        role: 'admin',
        status: 'active',
        isEmailVerified: true,
        isPhoneVerified: true,
        passwordHash: 'argon2id$hashedsecretforintegration',
      })
      .returning();

    testUserId = created.id;
  });

  afterAll(async () => {
    try {
      if (testUserId) {
        await db.delete(schema.users).where(eq(schema.users.id, testUserId));
        await redisClient.del(
          `{user:${testUserId}}:cache`,
          `{user:${testUserId}}:invalidated`,
        );
      }
    } catch {
      // Ignore cleanup error
    }

    await redisClient.quit();
    await pool.end();
  });

  it('populates Redis on cache miss and serves subsequent requests from Redis', async () => {
    const cacheKey = `{user:${testUserId}}:cache`;

    // Ensure clean initial state
    await redisClient.del(cacheKey);

    // First request: Cache miss -> queries PostgreSQL -> writes to Redis
    const user1 = await jwtStrategy.validate({
      sub: testUserId,
      email: testUserEmail,
      role: 'admin',
      token_type: 'access',
    });
    expect(user1).toBeDefined();
    expect(user1.id).toBe(testUserId);
    expect(user1.role).toBe('admin');

    // Verify key was created in real Redis
    const cachedRaw = await redisClient.get(cacheKey);
    expect(cachedRaw).not.toBeNull();
    const parsed = JSON.parse(cachedRaw);
    expect(parsed.id).toBe(testUserId);
    expect(parsed.role).toBe('admin');
    expect(parsed.passwordHash).toBeUndefined(); // Never stored

    // Verify TTL is between 1 and 60 seconds
    const ttl = await redisClient.ttl(cacheKey);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);

    // Second request: Cache hit -> reads from Redis
    const user2 = await jwtStrategy.validate({
      sub: testUserId,
      email: testUserEmail,
      token_type: 'access',
    });
    expect(user2).toBeDefined();
    expect(user2.id).toBe(testUserId);
    expect(user2.role).toBe('admin');
    expect(user2.createdAt).toBeInstanceOf(Date);
    expect(user2.passwordHash).toBeNull();
  });

  it('immediately invalidates Redis cache and reflects role demotion without stale window', async () => {
    const cacheKey = `{user:${testUserId}}:cache`;
    const tombstoneKey = `{user:${testUserId}}:invalidated`;

    // Ensure cached as admin
    await jwtStrategy.validate({
      sub: testUserId,
      email: testUserEmail,
      token_type: 'access',
    });
    expect(await redisClient.exists(cacheKey)).toBe(1);

    // Admin demotes user to customer
    const updated = await usersStore.update(testUserId, { role: 'customer' });
    expect(updated?.role).toBe('customer');

    // Invalidation check: Cache deleted, tombstone created
    expect(await redisClient.exists(cacheKey)).toBe(0);
    expect(await redisClient.exists(tombstoneKey)).toBe(1);

    // Next request MUST see the demoted role immediately
    const userAfterDemotion = await jwtStrategy.validate({
      sub: testUserId,
      email: testUserEmail,
      token_type: 'access',
    });
    expect(userAfterDemotion.role).toBe('customer');
  });

  it('immediately revokes access when user is suspended', async () => {
    const cacheKey = `{user:${testUserId}}:cache`;

    // Warm cache with active state
    await jwtStrategy.validate({
      sub: testUserId,
      email: testUserEmail,
      token_type: 'access',
    });
    expect(await redisClient.exists(cacheKey)).toBe(1);

    // Admin suspends user
    await usersStore.update(testUserId, { status: 'suspended' });
    expect(await redisClient.exists(cacheKey)).toBe(0);

    // Next request must be rejected with UnauthorizedException
    await expect(
      jwtStrategy.validate({
        sub: testUserId,
        email: testUserEmail,
        token_type: 'access',
      }),
    ).rejects.toThrow(UnauthorizedException);

    // Restore active status for subsequent tests
    await usersStore.update(testUserId, { status: 'active', role: 'admin' });
  });

  it('immediately revokes access on soft deletion', async () => {
    const cacheKey = `{user:${testUserId}}:cache`;

    // Warm cache
    await jwtStrategy.validate({
      sub: testUserId,
      email: testUserEmail,
      token_type: 'access',
    });
    expect(await redisClient.exists(cacheKey)).toBe(1);

    // Soft delete user
    await usersStore.softDelete(testUserId);
    expect(await redisClient.exists(cacheKey)).toBe(0);

    // Access must be rejected immediately
    await expect(
      jwtStrategy.validate({
        sub: testUserId,
        email: testUserEmail,
        token_type: 'access',
      }),
    ).rejects.toThrow(UnauthorizedException);

    // Restore active status
    await usersStore.update(testUserId, {
      status: 'active',
      deletedAt: null,
      role: 'admin',
    });
  });

  it('prevents ghost writes using atomic Lua tombstone verification', async () => {
    const cacheKey = `{user:${testUserId}}:cache`;
    const tombstoneKey = `{user:${testUserId}}:invalidated`;

    await redisClient.del(cacheKey, tombstoneKey);

    // Simulate concurrent scenario:
    // T1: Fetch starts
    const fetchStartedAt = Date.now();

    // Small delay to ensure timestamp progression
    await new Promise((r) => setTimeout(r, 20));

    // T2: Invalidation occurs (mutation sets tombstone)
    await usersStore.invalidateUserCache(testUserId);
    expect(await redisClient.exists(tombstoneKey)).toBe(1);

    // T3: In-flight query completes with stale record and attempts to safe-set cache
    const staleUser = {
      ...(await usersStore.findById(testUserId, { skipCache: true })),
      role: 'admin' as const,
    };

    // Attempt cache populate using safeSetUserCache logic
    const client = redisService.getClient();
    const result = await (client as any).eval(
      (UsersStore as any).SAFE_SET_LUA,
      2,
      cacheKey,
      tombstoneKey,
      fetchStartedAt.toString(),
      '60',
      JSON.stringify(staleUser),
    );

    // Atomic Lua script must drop the write (result == 0)
    expect(result).toBe(0);
    expect(await redisClient.exists(cacheKey)).toBe(0);
  });

  it('maintains consistent authorization state across multiple backend instances sharing Redis', async () => {
    // Instance A and Instance B share the same Redis and DB
    const storeInstanceA = new UsersStore(db as any, redisService);
    const storeInstanceB = new UsersStore(db as any, redisService);

    const jwtStrategyA = new JwtStrategy(
      { jwtSecret: 'secret' } as any,
      storeInstanceA,
    );
    const jwtStrategyB = new JwtStrategy(
      { jwtSecret: 'secret' } as any,
      storeInstanceB,
    );

    // Instance A warms the cache
    const userA = await jwtStrategyA.validate({
      sub: testUserId,
      email: testUserEmail,
      token_type: 'access',
    });
    expect(userA.role).toBe('admin');

    // Instance B reads from cache
    const userB = await jwtStrategyB.validate({
      sub: testUserId,
      email: testUserEmail,
      token_type: 'access',
    });
    expect(userB.role).toBe('admin');

    // Instance A updates role to customer
    await storeInstanceA.update(testUserId, { role: 'customer' });

    // Instance B immediately observes the demoted role
    const userBAfter = await jwtStrategyB.validate({
      sub: testUserId,
      email: testUserEmail,
      token_type: 'access',
    });
    expect(userBAfter.role).toBe('customer');
  });

  it('handles 25 concurrent authentication requests with atomic caching and zero race corruption', async () => {
    const cacheKey = `{user:${testUserId}}:cache`;
    await redisClient.del(cacheKey);

    const concurrentRequests = Array.from({ length: 25 }, () =>
      jwtStrategy.validate({
        sub: testUserId,
        email: testUserEmail,
        token_type: 'access',
      }),
    );

    const results = await Promise.all(concurrentRequests);
    expect(results).toHaveLength(25);
    for (const res of results) {
      expect(res.id).toBe(testUserId);
    }

    // Cache must be populated and valid
    const cached = await redisClient.get(cacheKey);
    expect(cached).not.toBeNull();
  });

  it('respects volatile-lru eviction policy and bounded 48mb maxmemory limit', async () => {
    const info = await redisClient.info('memory');
    expect(info).toContain('maxmemory_policy:volatile-lru');
    expect(info).toContain('maxmemory:50331648'); // 48 * 1024 * 1024 = 50331648 bytes
  });

  describe('TASK-09S Security Gate Invariants (SEC-09-A through SEC-09-E)', () => {
    it('SEC-09-A: prevents ghost write repopulation using monotonic generation counter mismatch', async () => {
      const cacheKey = `{user:${testUserId}}:cache`;
      const tombstoneKey = `{user:${testUserId}}:invalidated`;
      const genKey = `{user:${testUserId}}:gen`;

      // 1. Initial generation
      await redisClient.set(genKey, '5');
      await redisClient.del(cacheKey);

      // Invalidation occurs: increments generation to 6 and sets tombstone to '6'
      await redisClient.set(genKey, '6');
      await redisClient.set(tombstoneKey, '6');

      // Slow/stale query from generation 5 tries to populate cache using safeSetUserCache Lua
      const client = redisService.getClient();
      const evalResult = await (client as any).eval(
        (UsersStore as any).SAFE_SET_LUA,
        2,
        cacheKey,
        tombstoneKey,
        '5', // expected generation was 5, but tombstone is 6
        '60',
        JSON.stringify({ id: testUserId, role: 'admin' }),
      );

      // Generation mismatch causes write to be dropped
      expect(evalResult).toBe(0);
      expect(await redisClient.exists(cacheKey)).toBe(0);
    });

    it('SEC-09-B & SEC-09-D: RolesGuard authoritative database check blocks demoted admin even if Redis invalidation failed', async () => {
      // Restore user in DB as customer
      await db
        .update(schema.users)
        .set({ role: 'customer', status: 'active' })
        .where(eq(schema.users.id, testUserId));

      // Simulate Redis invalidation failure: cache still contains stale 'admin' payload
      const cacheKey = `{user:${testUserId}}:cache`;
      await redisClient.setex(
        cacheKey,
        60,
        JSON.stringify({
          id: testUserId,
          email: testUserEmail,
          role: 'admin',
          status: 'active',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      );

      // User validates JWT (which hits Redis cache and returns cached user with role: 'admin')
      const cachedAdmin = await jwtStrategy.validate({
        sub: testUserId,
        email: testUserEmail,
        token_type: 'access',
      });
      expect(cachedAdmin.role).toBe('admin'); // Cache is artificially stale

      // RolesGuard protects administrative endpoint
      const reflector = new Reflector();
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin']);
      const rolesGuard = new RolesGuard(reflector, usersStore);

      const mockExecutionContext = {
        getHandler: () => ({}),
        getClass: () => ({}),
        switchToHttp: () => ({
          getRequest: () => ({
            user: cachedAdmin,
          }),
        }),
      } as unknown as ExecutionContext;

      // Authoritative check must detect that DB role is 'customer' and reject with 403 Forbidden
      await expect(
        rolesGuard.canActivate(mockExecutionContext),
      ).rejects.toThrow(ForbiddenException);

      // RolesGuard self-heals by invalidating the stale cache entry
      expect(await redisClient.exists(cacheKey)).toBe(0);
    });

    it('SEC-09-C: Monotonic generation counters prevent invalidation races independent of local clock skew', async () => {
      const genKey = `{user:${testUserId}}:gen`;
      const tombstoneKey = `{user:${testUserId}}:invalidated`;
      const cacheKey = `{user:${testUserId}}:cache`;

      // Instance 1 increments generation in Redis
      await redisClient.del(cacheKey);
      const startGen = await usersStore.getUserGeneration(testUserId);

      // Mutate user in DB and invalidate
      await usersStore.invalidateUserCache(testUserId);
      const nextGen = await usersStore.getUserGeneration(testUserId);
      expect(Number(nextGen)).toBeGreaterThan(Number(startGen));

      // Client with a clock skewed 5 minutes in the past attempts safeSet with startGen
      const client = redisService.getClient();
      const writeResult = await (client as any).eval(
        (UsersStore as any).SAFE_SET_LUA,
        2,
        cacheKey,
        genKey,
        startGen,
        '60',
        JSON.stringify({ id: testUserId, role: 'admin' }),
      );

      // Lua script rejects because startGen !== nextGen, regardless of timestamp or clock skew
      expect(writeResult).toBe(0);
      expect(await redisClient.exists(cacheKey)).toBe(0);
    });

    it('SEC-09-E: Dropped write when DB fetch takes longer than 10 seconds ceiling', async () => {
      const staleUser = {
        id: testUserId,
        email: testUserEmail,
        role: 'customer' as const,
        status: 'active' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as schema.User;

      // Fetch started 11 seconds ago (exceeds 10,000ms latency ceiling)
      const fetchStartedAt = Date.now() - 11000;
      const cached = await (usersStore as any).safeSetUserCache(
        testUserId,
        staleUser,
        fetchStartedAt,
      );

      expect(cached).toBe(false);
      expect(await redisClient.exists(`{user:${testUserId}}:cache`)).toBe(0);
    });

    it('SEC-09-F: Redis volatile-lru eviction of generation key fails-safe and drops cache population', async () => {
      const genKey = `{user:${testUserId}}:gen`;
      const cacheKey = `{user:${testUserId}}:cache`;

      // Simulate key eviction under memory pressure (delete genKey)
      await redisClient.del(genKey);
      await redisClient.del(cacheKey);

      // Attempt safeSet expecting generation '5' when key has been evicted
      const client = redisService.getClient();
      const writeResult = await (client as any).eval(
        (UsersStore as any).SAFE_SET_LUA,
        2,
        cacheKey,
        genKey,
        '5',
        '60',
        JSON.stringify({ id: testUserId, role: 'customer' }),
      );

      // Must be dropped (returns 0)
      expect(writeResult).toBe(0);
      expect(await redisClient.exists(cacheKey)).toBe(0);
    });

    it('SEC-09-G: Direct DB failure during privileged RolesGuard check strictly fails closed with 403 Forbidden', async () => {
      const reflector = new Reflector();
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin']);
      const rolesGuard = new RolesGuard(reflector, usersStore);

      const mockContext = {
        getHandler: () => ({}),
        getClass: () => ({}),
        switchToHttp: () => ({
          getRequest: () => ({
            user: { id: testUserId, role: 'admin', status: 'active' },
          }),
        }),
      } as unknown as ExecutionContext;

      // Mock database error during authoritative verification
      jest
        .spyOn(usersStore, 'findById')
        .mockRejectedValueOnce(new Error('PostgreSQL connection timeout'));

      await expect(rolesGuard.canActivate(mockContext)).rejects.toThrow(
        new ForbiddenException(
          'Authoritative database verification failed. Privileged access denied.',
        ),
      );
    });
  });
});
