import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { randomInt } from 'crypto';
import Redis from 'ioredis';
import { ConfigService } from '@config/config.service';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;

  constructor(private readonly config: ConfigService) {
    this.client = new Redis({
      host: this.config.redisHost,
      port: this.config.redisPort,
      password: this.config.redisPassword,
      connectTimeout: 5000,
      commandTimeout: 3000,
      maxRetriesPerRequest: 3,
      enableReadyCheck: false,
      lazyConnect: false,
    });

    this.client.on('error', (err: unknown) => {
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === 'string'
            ? err
            : JSON.stringify(err);
      this.logger.warn(`Redis connection error: ${msg}`);
    });

    this.registerCustomCommands();
  }

  private registerCustomCommands() {
    try {
      if (typeof this.client.defineCommand === 'function') {
        this.client.defineCommand('safeSetUser', {
          numberOfKeys: 2,
          lua: `
            local cacheKey = KEYS[1]
            local genKey = KEYS[2]
            local expectedGen = ARGV[1]
            local ttl = tonumber(ARGV[2])
            local payload = ARGV[3]

            local currentGen = redis.call('GET', genKey) or '0'
            if currentGen ~= expectedGen then
              return 0
            else
              redis.call('SETEX', cacheKey, ttl, payload)
              return 1
            end
          `,
        });
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === 'string'
            ? err
            : JSON.stringify(err);
      this.logger.warn(`Failed to define custom Redis commands: ${msg}`);
    }
  }

  onModuleDestroy() {
    this.client.disconnect();
  }

  async ping(): Promise<void> {
    await this.client.ping();
  }

  getClient(): Redis {
    return this.client;
  }

  // Session management
  async setSession(
    userId: string,
    token: string,
    expiresIn: string,
  ): Promise<void> {
    const ttl = this.parseDuration(expiresIn);
    await this.client.setex(`auth:session:${userId}`, ttl, token);
  }

  async getSession(userId: string): Promise<string | null> {
    return this.client.get(`auth:session:${userId}`);
  }

  async deleteSession(userId: string): Promise<void> {
    await this.client.del(`auth:session:${userId}`);
  }

  /**
   * Atomic Compare-And-Swap (CAS) session rotation via server-side Lua script.
   *
   * Verifies that the current active session in Redis strictly matches `expectedOldToken`.
   * If matched, atomically updates the key to `newToken` with `expiresIn` TTL and returns true.
   * If mismatched, missing, or already rotated, does NOT modify the key and returns false.
   *
   * Guarantees:
   * - Exactly ONE concurrent request can successfully rotate a given active token.
   * - A replayed or superseded token returns false and cannot overwrite newer sessions.
   * - Redis TTL is updated atomically alongside the token.
   */
  async rotateSession(
    userId: string,
    expectedOldToken: string,
    newToken: string,
    expiresIn: string,
  ): Promise<boolean> {
    const ttl = this.parseDuration(expiresIn);
    const script = `
      local current = redis.call('get', KEYS[1])
      if current ~= false and current ~= nil and current == ARGV[1] then
        redis.call('setex', KEYS[1], tonumber(ARGV[3]), ARGV[2])
        return 1
      else
        return 0
      end
    `.trim();

    const result = await this.client.eval(
      script,
      1,
      `auth:session:${userId}`,
      expectedOldToken,
      newToken,
      ttl.toString(),
    );

    return result === 1;
  }

  /**
   * Atomic Compare-And-Delete (CAD) session revocation via server-side Lua script.
   *
   * Verifies that `auth:session:${userId}` currently contains `expectedToken`.
   * If matched, atomically deletes the key and returns true.
   * If mismatched, missing, or already rotated, does NOT delete the key and returns false.
   *
   * Guarantees:
   * - A stale or superseded refresh token cannot revoke a newer rotated session.
   * - Cross-device and concurrent race isolation is strictly maintained.
   */
  async compareAndDeleteSession(
    userId: string,
    expectedToken: string,
  ): Promise<boolean> {
    const script = `
      local current = redis.call('get', KEYS[1])
      if current ~= false and current ~= nil and current == ARGV[1] then
        return redis.call('del', KEYS[1])
      else
        return 0
      end
    `.trim();

    const result = await this.client.eval(
      script,
      1,
      `auth:session:${userId}`,
      expectedToken,
    );

    return result === 1;
  }

  // Email verification code
  async setVerificationCode(
    email: string,
    code: string,
    expiresIn: string,
  ): Promise<void> {
    const ttl = this.parseDuration(expiresIn);
    await this.client.setex(`auth:verify:${email}`, ttl, code);
  }

  async getVerificationCode(email: string): Promise<string | null> {
    return this.client.get(`auth:verify:${email}`);
  }

  async deleteVerificationCode(email: string): Promise<void> {
    await this.client.del(`auth:verify:${email}`);
  }

  // Phone verification code
  async setPhoneVerificationCode(
    phone: string,
    code: string,
    expiresIn: string,
  ): Promise<void> {
    const ttl = this.parseDuration(expiresIn);
    await this.client.setex(`auth:verify-phone:${phone}`, ttl, code);
  }

  async getPhoneVerificationCode(phone: string): Promise<string | null> {
    return this.client.get(`auth:verify-phone:${phone}`);
  }

  async deletePhoneVerificationCode(phone: string): Promise<void> {
    await this.client.del(`auth:verify-phone:${phone}`);
  }

  // Password reset code
  async setResetCode(
    email: string,
    code: string,
    expiresIn: string,
  ): Promise<void> {
    const ttl = this.parseDuration(expiresIn);
    await this.client.setex(`auth:reset:${email}`, ttl, code);
  }

  async getResetCode(email: string): Promise<string | null> {
    return this.client.get(`auth:reset:${email}`);
  }

  async deleteResetCode(email: string): Promise<void> {
    await this.client.del(`auth:reset:${email}`);
  }

  // Generic cache methods
  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.client.setex(key, ttlSeconds, value);
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  // OTP brute-force protection \u2014 tracks failed verify attempts per email.
  // The counter key is namespaced separately from the code itself so clearing
  // one does not affect the other.
  async incrementVerifyAttempts(email: string): Promise<number> {
    const key = `auth:verify:attempts:${email}`;
    const count = await this.client.incr(key);
    if (count === 1) {
      // Set TTL on first increment to match the code lifetime (4 hours by default).
      // This way the counter automatically expires with the code.
      await this.client.expire(key, 4 * 60 * 60);
    }
    return count;
  }

  async clearVerifyAttempts(email: string): Promise<void> {
    await this.client.del(`auth:verify:attempts:${email}`);
  }

  async incrementPhoneVerifyAttempts(phone: string): Promise<number> {
    const key = `auth:verify-phone:attempts:${phone}`;
    const count = await this.client.incr(key);
    if (count === 1) {
      // Phone OTPs usually have a shorter TTL, but we match the 4h max to be safe.
      await this.client.expire(key, 4 * 60 * 60);
    }
    return count;
  }

  async clearPhoneVerifyAttempts(phone: string): Promise<void> {
    await this.client.del(`auth:verify-phone:attempts:${phone}`);
  }

  async incrementResetAttempts(email: string): Promise<number> {
    const key = `auth:reset:attempts:${email}`;
    const count = await this.client.incr(key);
    if (count === 1) {
      await this.client.expire(key, 4 * 60 * 60);
    }
    return count;
  }

  async clearResetAttempts(email: string): Promise<void> {
    await this.client.del(`auth:reset:attempts:${email}`);
  }

  // Generate an 8-digit cryptographically secure OTP code.
  // crypto.randomInt(min, max) uses the OS CSPRNG — unlike Math.random(),
  // its output cannot be predicted by observing previous values.
  // Range: 10_000_000–99_999_999 (inclusive min, exclusive max) = 8 digits guaranteed.
  generateCode(): string {
    return randomInt(10_000_000, 100_000_000).toString();
  }

  // Generate a 6-digit cryptographically secure OTP code for SMS.
  generate6DigitCode(): string {
    return randomInt(100_000, 1_000_000).toString();
  }

  // Parse duration string to seconds (e.g., "15m" -> 900, "7d" -> 604800)
  private parseDuration(duration: string): number {
    const unit = duration.slice(-1);
    const value = parseInt(duration.slice(0, -1));

    switch (unit) {
      case 's':
        return value;
      case 'm':
        return value * 60;
      case 'h':
        return value * 60 * 60;
      case 'd':
        return value * 24 * 60 * 60;
      default:
        return 900; // default 15 minutes
    }
  }
}
