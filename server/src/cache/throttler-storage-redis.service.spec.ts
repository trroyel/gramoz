import Redis from 'ioredis';
import { ThrottlerStorageRedisService } from './throttler-storage-redis.service';

describe('ThrottlerStorageRedisService (Unit & Distributed Storage Tests — TASK-07)', () => {
  let redisClient: Redis;
  let service: ThrottlerStorageRedisService;
  const testKeyPrefix = `test:throttle:${Date.now()}`;

  beforeAll(() => {
    redisClient = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: Number(process.env.REDIS_PORT) || 6380,
      password: process.env.REDIS_PASSWORD || 'redis_pass',
      maxRetriesPerRequest: 2,
    });
    service = new ThrottlerStorageRedisService(redisClient);
  });

  afterAll(async () => {
    // Clean up test keys
    try {
      const keys = await redisClient.keys(`*{throttle:${testKeyPrefix}*`);
      if (keys.length > 0) {
        await redisClient.del(...keys);
      }
    } catch {
      // ignore
    }
    service.onModuleDestroy();
    redisClient.disconnect(false);
  });

  it('should increment hits sequentially up to limit without blocking', async () => {
    const key = `${testKeyPrefix}:seq`;
    const ttl = 60_000;
    const limit = 5;
    const blockDuration = 60_000;

    for (let hit = 1; hit <= limit; hit++) {
      const record = await service.increment(
        key,
        ttl,
        limit,
        blockDuration,
        'default',
      );
      expect(record.totalHits).toBe(hit);
      expect(record.isBlocked).toBe(false);
      expect(record.timeToExpire).toBeGreaterThan(0);
      expect(record.timeToBlockExpire).toBe(0);
    }
  });

  it('should block on the request exceeding the limit and return timeToBlockExpire', async () => {
    const key = `${testKeyPrefix}:block`;
    const ttl = 60_000;
    const limit = 3;
    const blockDuration = 60_000;

    // Hits 1, 2, 3 allowed
    await service.increment(key, ttl, limit, blockDuration, 'default');
    await service.increment(key, ttl, limit, blockDuration, 'default');
    const hit3 = await service.increment(
      key,
      ttl,
      limit,
      blockDuration,
      'default',
    );
    expect(hit3.totalHits).toBe(3);
    expect(hit3.isBlocked).toBe(false);

    // Hit 4 exceeds limit (3) -> blocked
    const hit4 = await service.increment(
      key,
      ttl,
      limit,
      blockDuration,
      'default',
    );
    expect(hit4.totalHits).toBe(4);
    expect(hit4.isBlocked).toBe(true);
    expect(hit4.timeToBlockExpire).toBeGreaterThan(0);
    expect(hit4.timeToBlockExpire).toBeLessThanOrEqual(60);
  });

  it('should atomically handle concurrent increment requests under contention', async () => {
    const key = `${testKeyPrefix}:concurrency`;
    const ttl = 60_000;
    const limit = 5;
    const blockDuration = 60_000;
    const totalRequests = 10;

    const promises = Array.from({ length: totalRequests }).map(() =>
      service.increment(key, ttl, limit, blockDuration, 'default'),
    );

    const results = await Promise.all(promises);

    const allowed = results.filter((r) => !r.isBlocked);
    const blocked = results.filter((r) => r.isBlocked);

    expect(allowed.length).toBe(5);
    expect(blocked.length).toBe(5);

    // Final totalHits in the store must equal exactly 10
    const finalRecord = await service.increment(
      key,
      ttl,
      limit,
      blockDuration,
      'default',
    );
    expect(finalRecord.totalHits).toBe(11);
    expect(finalRecord.isBlocked).toBe(true);
  });

  it('should execute documented fail-policy: fallback to in-memory store when Redis fails', async () => {
    // Create an instance pointing to a closed / invalid Redis port
    const failingRedis = new Redis({
      host: '127.0.0.1',
      port: 59999, // Unused port that will fail connection
      maxRetriesPerRequest: 0,
      connectTimeout: 200,
      retryStrategy: () => null, // Do not retry
      lazyConnect: true,
    });

    const resilientService = new ThrottlerStorageRedisService(failingRedis);
    const key = `${testKeyPrefix}:fallback`;

    // Must not throw an unhandled exception or crash; must gracefully fall back
    const record1 = await resilientService.increment(
      key,
      60_000,
      2,
      60_000,
      'default',
    );
    expect(record1.totalHits).toBe(1);
    expect(record1.isBlocked).toBe(false);

    const record2 = await resilientService.increment(
      key,
      60_000,
      2,
      60_000,
      'default',
    );
    expect(record2.totalHits).toBe(2);
    expect(record2.isBlocked).toBe(false);

    const record3 = await resilientService.increment(
      key,
      60_000,
      2,
      60_000,
      'default',
    );
    expect(record3.totalHits).toBe(3);
    expect(record3.isBlocked).toBe(true);

    try {
      resilientService.onModuleDestroy();
      failingRedis.disconnect(false);
    } catch {
      // ignore
    }
  });

  it('should reset window after TTL expires with deterministic time controls', async () => {
    const key = `${testKeyPrefix}:ttl-reset`;
    const shortTtl = 400; // 400ms
    const limit = 2;
    const blockDuration = 400; // 400ms

    // Exceed limit
    await service.increment(key, shortTtl, limit, blockDuration, 'default');
    await service.increment(key, shortTtl, limit, blockDuration, 'default');
    const blockedHit = await service.increment(
      key,
      shortTtl,
      limit,
      blockDuration,
      'default',
    );
    expect(blockedHit.isBlocked).toBe(true);

    // Wait for TTL window to elapse
    await new Promise((resolve) => setTimeout(resolve, 550));

    // Next hit after expiry resets counter back to 1
    const freshRecord = await service.increment(
      key,
      shortTtl,
      limit,
      blockDuration,
      'default',
    );
    expect(freshRecord.totalHits).toBe(1);
    expect(freshRecord.isBlocked).toBe(false);
  });
});
