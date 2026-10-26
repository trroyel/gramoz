import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import Redis, { RedisOptions } from 'ioredis';

export interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

/**
 * Distributed, multi-instance Redis storage provider for NestJS Throttler.
 *
 * Implements atomic token bucket/fixed window counters with dedicated block duration
 * via server-side Lua scripting.
 *
 * Fail Policy:
 * If Redis is temporarily unreachable, down, or encounters transient timeout errors,
 * operations fail-open to an internal in-memory ThrottlerStorageService fallback.
 * This guarantees that authentication and API endpoints never fail with HTTP 500
 * due to cache layer degradation while preserving instance-local abuse protection.
 */
@Injectable()
export class ThrottlerStorageRedisService
  implements ThrottlerStorage, OnModuleDestroy
{
  private readonly logger = new Logger(ThrottlerStorageRedisService.name);
  private readonly redis?: Redis;
  private readonly fallbackStorage: ThrottlerStorageService;
  private readonly disconnectRequired: boolean = false;
  private isRedisHealthy = true;
  private readonly scriptSrc: string;

  constructor(redisOrOptions?: Redis | RedisOptions | string) {
    this.fallbackStorage = new ThrottlerStorageService();

    if (redisOrOptions instanceof Redis) {
      this.redis = redisOrOptions;
      this.disconnectRequired = false;
    } else if (typeof redisOrOptions === 'string') {
      this.redis = new Redis(redisOrOptions, {
        maxRetriesPerRequest: 2,
        enableReadyCheck: false,
      });
      this.disconnectRequired = true;
    } else if (redisOrOptions && typeof redisOrOptions === 'object') {
      this.redis = new Redis({
        ...redisOrOptions,
        maxRetriesPerRequest: 2,
        enableReadyCheck: false,
      });
      this.disconnectRequired = true;
    }

    this.scriptSrc = `
      local hitKey = KEYS[1]
      local blockKey = KEYS[2]
      local throttlerName = ARGV[1]
      local ttl = tonumber(ARGV[2])
      local limit = tonumber(ARGV[3])
      local blockDuration = tonumber(ARGV[4])

      local totalHits = redis.call('INCR', hitKey)
      local timeToExpire = redis.call('PTTL', hitKey)

      if timeToExpire <= 0 then
        redis.call('PEXPIRE', hitKey, ttl)
        timeToExpire = ttl
      end

      local isBlocked = redis.call('GET', blockKey)
      local timeToBlockExpire = 0

      if isBlocked then
        timeToBlockExpire = redis.call('PTTL', blockKey)
      elseif totalHits > limit then
        redis.call('SET', blockKey, 1, 'PX', blockDuration)
        isBlocked = '1'
        timeToBlockExpire = blockDuration
      end

      if isBlocked and timeToBlockExpire <= 0 then
        redis.call('DEL', blockKey)
        redis.call('SET', hitKey, 1, 'PX', ttl)
        totalHits = 1
        timeToExpire = ttl
        isBlocked = false
      end

      return { totalHits, timeToExpire, isBlocked and 1 or 0, timeToBlockExpire }
    `
      .replace(/^\s+/gm, '')
      .trim();

    if (this.redis && typeof this.redis.defineCommand === 'function') {
      try {
        this.redis.defineCommand('throttlerIncrement', {
          numberOfKeys: 2,
          lua: this.scriptSrc,
        });
      } catch {
        // Fall back to standard eval
      }
    }
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    if (!this.redis) {
      return this.fallbackStorage.increment(
        key,
        ttl,
        limit,
        blockDuration,
        throttlerName,
      );
    }

    try {
      // Use Redis hash tags `{...}` so keys evaluate on the same Redis Cluster slot
      const hitKey = `{throttle:${key}:${throttlerName}}:hits`;
      const blockKey = `{throttle:${key}:${throttlerName}}:blocked`;

      let results: [number, number, number, number];
      const client = this.redis as unknown as {
        throttlerIncrement?: (
          hitKey: string,
          blockKey: string,
          throttlerName: string,
          ttl: number,
          limit: number,
          blockDuration: number,
        ) => Promise<[number, number, number, number]>;
      };
      if (typeof client.throttlerIncrement === 'function') {
        results = await client.throttlerIncrement(
          hitKey,
          blockKey,
          throttlerName,
          ttl,
          limit,
          blockDuration,
        );
      } else {
        results = (await this.redis.call(
          'eval',
          this.scriptSrc,
          2,
          hitKey,
          blockKey,
          throttlerName,
          ttl,
          limit,
          blockDuration,
        )) as [number, number, number, number];
      }

      if (!Array.isArray(results) || results.length < 4) {
        throw new TypeError(
          `Unexpected Lua script result format: ${JSON.stringify(results)}`,
        );
      }

      const [totalHits, timeToExpire, isBlocked, timeToBlockExpire] = results;

      if (!this.isRedisHealthy) {
        this.logger.log('Redis connection restored for throttler storage.');
        this.isRedisHealthy = true;
      }

      return {
        totalHits,
        timeToExpire: Math.max(1, Math.ceil(timeToExpire / 1000)),
        isBlocked: isBlocked === 1,
        timeToBlockExpire: Math.max(0, Math.ceil(timeToBlockExpire / 1000)),
      };
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : JSON.stringify(err);

      if (this.isRedisHealthy) {
        this.logger.warn(
          `Redis error during rate limiting increment (${errorMessage}). ` +
            'Executing documented fail-policy: falling back to local memory store.',
        );
        this.isRedisHealthy = false;
      }

      return this.fallbackStorage.increment(
        key,
        ttl,
        limit,
        blockDuration,
        throttlerName,
      );
    }
  }

  onModuleDestroy() {
    this.fallbackStorage.onApplicationShutdown();
    if (this.disconnectRequired && this.redis) {
      this.redis.disconnect(false);
    }
  }
}
