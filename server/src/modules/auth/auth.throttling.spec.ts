/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { Test, TestingModule } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import cookie from '@fastify/cookie';
import Redis from 'ioredis';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ConfigService } from '@config/config.service';
import { AllExceptionsFilter } from '../../common/filters/all-exceptions.filter';
import {
  AppThrottlerGuard,
  normalizeAccountIdentifier,
} from '../../common/guards/app-throttler.guard';
import { ThrottlerStorageRedisService } from '@cache/throttler-storage-redis.service';

describe('Authentication Rate Limiting & Abuse Protection (HTTP & Redis Integration — TASK-07)', () => {
  let app: NestFastifyApplication;
  let redisClient: Redis;
  let storageService: ThrottlerStorageRedisService;

  let mockAuthService: {
    login: jest.Mock;
    register: jest.Mock;
    forgotPassword: jest.Mock;
    resetPassword: jest.Mock;
    sendPhoneOtp: jest.Mock;
    verifyPhoneOtp: jest.Mock;
    verifyEmail: jest.Mock;
    resendVerification: jest.Mock;
    refreshToken: jest.Mock;
    logout: jest.Mock;
    getMe: jest.Mock;
  };

  let mockConfigService: Partial<ConfigService>;

  beforeAll(async () => {
    redisClient = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: Number(process.env.REDIS_PORT) || 6380,
      password: process.env.REDIS_PASSWORD || 'redis_pass',
      maxRetriesPerRequest: 2,
    });
    storageService = new ThrottlerStorageRedisService(redisClient);

    mockAuthService = {
      login: jest.fn().mockResolvedValue({
        success: true,
        message: 'Login successful',
        data: {
          user: { id: 'u1', email: 'test@gramoz.com', role: 'customer' },
          accessToken: 'mock-access-token',
          refreshToken: 'mock-refresh-token',
        },
      }),
      register: jest.fn().mockResolvedValue({
        success: true,
        message: 'Registration successful',
        data: { id: 'u1', email: 'new@gramoz.com', role: 'customer' },
      }),
      forgotPassword: jest.fn().mockResolvedValue({
        success: true,
        message: 'If the email exists, a reset code has been sent',
        data: null,
      }),
      resetPassword: jest.fn().mockResolvedValue({
        success: true,
        message: 'Password reset successfully',
        data: null,
      }),
      sendPhoneOtp: jest.fn().mockResolvedValue({
        success: true,
        message: 'Verification code sent to your phone',
        data: null,
      }),
      verifyPhoneOtp: jest.fn().mockResolvedValue({
        success: true,
        message: 'Phone number verified successfully',
        data: null,
      }),
      verifyEmail: jest.fn().mockResolvedValue({
        success: true,
        message: 'Email verified successfully',
        data: null,
      }),
      resendVerification: jest.fn().mockResolvedValue({
        success: true,
        message: 'Verification code sent to your email',
        data: null,
      }),
      refreshToken: jest.fn().mockResolvedValue({
        success: true,
        message: 'Token refreshed successfully',
        data: { accessToken: 'new-token', refreshToken: 'new-refresh' },
      }),
      logout: jest.fn().mockResolvedValue({
        success: true,
        message: 'Logged out successfully',
      }),
      getMe: jest.fn().mockResolvedValue({
        success: true,
        message: 'User profile retrieved',
        data: { id: 'u1', email: 'test@gramoz.com' },
      }),
    };

    mockConfigService = {
      cookieSecret: 'test-cookie-secret-32-chars-long-12345',
      frontendUrl: 'http://localhost:3000',
      verifyEmailTokenExpiresIn: '4h',
      resetPasswordTokenExpiresIn: '1h',
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRootAsync({
          useFactory: () => ({
            throttlers: [
              {
                name: 'default',
                ttl: 60_000,
                limit: 10,
              },
              {
                name: 'account',
                ttl: 60_000,
                limit: 5,
                getTracker: (req) => {
                  return normalizeAccountIdentifier(req?.body) || 'anonymous';
                },
              },
            ],
            storage: storageService,
          }),
        }),
      ],
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: APP_GUARD, useClass: AppThrottlerGuard },
      ],
    }).compile();

    const fastifyAdapter = new FastifyAdapter({
      trustProxy: 1, // Test proxy hop configuration
    });

    app =
      moduleFixture.createNestApplication<NestFastifyApplication>(
        fastifyAdapter,
      );

    await app.register(cookie as any, {
      secret: mockConfigService.cookieSecret,
    });

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());

    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    // Clear all throttler keys created during tests
    try {
      const keys = await redisClient.keys('*throttle:*');
      if (keys.length > 0) {
        await redisClient.del(...keys);
      }
    } catch {
      // ignore
    }
    storageService.onModuleDestroy();
    redisClient.disconnect(false);
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('1. Login Endpoint Abuse Protection (CWE-307 / B-AUTH-12 / SEC-04)', () => {
    it('should allow legitimate login attempts below the limit and execute business logic', async () => {
      const email = `legit-${Date.now()}@gramoz.com`;

      for (let i = 1; i <= 3; i++) {
        const response = await app.inject({
          method: 'POST',
          url: '/auth/login',
          payload: { email, password: 'SecurePassword123!' },
          headers: { 'x-forwarded-for': '198.51.100.10' },
        });

        expect(response.statusCode).toBe(201);
        const body = JSON.parse(response.body);
        expect(body.success).toBe(true);
        expect(response.headers['x-ratelimit-remaining']).toBeDefined();
      }

      expect(mockAuthService.login).toHaveBeenCalledTimes(3);
    });

    it('should block the 6th login attempt targeting the same account with HTTP 429 and Retry-After', async () => {
      const email = `target-${Date.now()}@gramoz.com`;
      const clientIp = '198.51.100.20';

      // Attempts 1 through 5: Allowed
      for (let i = 1; i <= 5; i++) {
        const res = await app.inject({
          method: 'POST',
          url: '/auth/login',
          payload: { email, password: `WrongPassword${i}!` },
          headers: { 'x-forwarded-for': clientIp },
        });
        expect(res.statusCode).toBe(201);
      }
      expect(mockAuthService.login).toHaveBeenCalledTimes(5);

      // Attempt 6: Exceeds account limit (5) -> must be rejected with HTTP 429
      const blockedRes = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email, password: 'GuessPassword6!' },
        headers: { 'x-forwarded-for': clientIp },
      });

      expect(blockedRes.statusCode).toBe(429);
      const blockedBody = JSON.parse(blockedRes.body);
      expect(blockedBody.success).toBe(false);
      expect(blockedBody.error.message).toMatch(/Too many requests/i);

      // Verify standard Retry-After header presence
      expect(blockedRes.headers['retry-after']).toBeDefined();
      const retryAfter = Number(blockedRes.headers['retry-after']);
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(60);

      // Verify AuthService.login was NOT called on the blocked request (prevents password hashing DoS)
      expect(mockAuthService.login).toHaveBeenCalledTimes(5);
    });

    it('should prevent distributed brute-force: block 6th attempt targeting same account across different IPs', async () => {
      const email = `distributed-target-${Date.now()}@gramoz.com`;

      // 5 different IP addresses targeting the exact same user account
      for (let i = 1; i <= 5; i++) {
        const res = await app.inject({
          method: 'POST',
          url: '/auth/login',
          payload: { email, password: `AttackPass${i}` },
          headers: { 'x-forwarded-for': `203.0.113.${10 + i}` },
        });
        expect(res.statusCode).toBe(201);
      }

      // 6th attempt from a brand new 6th IP address targeting the same account
      const distributedBlockedRes = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email, password: 'NewIpSameAccountPassword' },
        headers: { 'x-forwarded-for': '203.0.113.99' },
      });

      expect(distributedBlockedRes.statusCode).toBe(429);
      expect(distributedBlockedRes.headers['retry-after']).toBeDefined();
    });

    it('should prevent credential spraying: block 11th request from single IP targeting different accounts', async () => {
      const attackerIp = '198.51.100.77';

      // Single IP attempts 10 different accounts (allowed by IP limit: 10)
      for (let i = 1; i <= 10; i++) {
        const res = await app.inject({
          method: 'POST',
          url: '/auth/login',
          payload: {
            email: `victim-${i}-${Date.now()}@gramoz.com`,
            password: 'SprayingPassword123!',
          },
          headers: { 'x-forwarded-for': attackerIp },
        });
        expect(res.statusCode).toBe(201);
      }

      // 11th request from same IP targeting yet another account -> blocked by IP rate limit
      const sprayBlockedRes = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          email: `victim-11-${Date.now()}@gramoz.com`,
          password: 'SprayingPassword123!',
        },
        headers: { 'x-forwarded-for': attackerIp },
      });

      expect(sprayBlockedRes.statusCode).toBe(429);
      expect(sprayBlockedRes.headers['retry-after']).toBeDefined();
    });

    it('should normalize account identifiers: casing and whitespace do not bypass limits', async () => {
      const base = `normalize-${Date.now()}@gramoz.com`;
      const variations = [
        base.toLowerCase(),
        base.toUpperCase(),
        `  ${base.toLowerCase()}  `,
        base.charAt(0).toUpperCase() + base.slice(1),
        ` ${base.toUpperCase()} `,
      ];

      for (const emailVar of variations) {
        const res = await app.inject({
          method: 'POST',
          url: '/auth/login',
          payload: { email: emailVar, password: 'ValidPassword123!' },
          headers: { 'x-forwarded-for': '198.51.100.88' },
        });
        expect(res.statusCode).toBe(201);
      }

      // 6th attempt with another casing variant must be throttled
      const variantBlockedRes = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: base.toUpperCase(), password: 'AnotherVariant!' },
        headers: { 'x-forwarded-for': '198.51.100.88' },
      });

      expect(variantBlockedRes.statusCode).toBe(429);
    });

    it('should safely trust proxy: client-forged X-Forwarded-For prefixes cannot bypass limits', async () => {
      const email = `spoof-test-${Date.now()}@gramoz.com`;
      const realEdgeProxyIp = '198.51.100.99';

      // Attacker attempts to forge X-Forwarded-For: "fake-client-ip, real-client-ip"
      for (let i = 1; i <= 5; i++) {
        const res = await app.inject({
          method: 'POST',
          url: '/auth/login',
          payload: { email, password: 'Password123!' },
          headers: {
            'x-forwarded-for': `1.1.1.${i}, ${realEdgeProxyIp}`,
          },
        });
        expect(res.statusCode).toBe(201);
      }

      // 6th attempt with new forged leftmost IP still shares the realEdgeProxyIp and account identifier
      const blockedRes = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email, password: 'Password123!' },
        headers: {
          'x-forwarded-for': `1.1.1.99, ${realEdgeProxyIp}`,
        },
      });

      expect(blockedRes.statusCode).toBe(429);
    });
  });

  describe('2. Password Reset Abuse Protection (Email Bombing Prevention)', () => {
    it('should throttle excessive forgot-password requests to 3 per window without disclosing account existence', async () => {
      const email = `reset-abuse-${Date.now()}@gramoz.com`;
      const ip = '198.51.100.120';

      // 3 requests allowed
      for (let i = 1; i <= 3; i++) {
        const res = await app.inject({
          method: 'POST',
          url: '/auth/forgot-password',
          payload: { email },
          headers: { 'x-forwarded-for': ip },
        });

        expect(res.statusCode).toBe(201);
        const body = JSON.parse(res.body);
        expect(body.success).toBe(true);
        expect(body.message).toMatch(
          /If the email exists, a reset code has been sent/i,
        );
      }

      // 4th request exceeds account limit (3) -> blocked with 429
      const blockedRes = await app.inject({
        method: 'POST',
        url: '/auth/forgot-password',
        payload: { email },
        headers: { 'x-forwarded-for': ip },
      });

      expect(blockedRes.statusCode).toBe(429);
      expect(blockedRes.headers['retry-after']).toBeDefined();
    });
  });

  describe('3. Registration & Phone OTP Abuse Protection', () => {
    it('should throttle registration requests exceeding policy', async () => {
      const email = `reg-abuse-${Date.now()}@gramoz.com`;
      const ip = '198.51.100.130';

      for (let i = 1; i <= 3; i++) {
        const res = await app.inject({
          method: 'POST',
          url: '/auth/register',
          payload: {
            email,
            password: 'StrongPassword123!',
            fullName: 'Spam Tester',
          },
          headers: { 'x-forwarded-for': ip },
        });
        expect(res.statusCode).toBe(201);
      }

      const blockedRes = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          email,
          password: 'StrongPassword123!',
          fullName: 'Spam Tester',
        },
        headers: { 'x-forwarded-for': ip },
      });

      expect(blockedRes.statusCode).toBe(429);
    });
  });

  describe('4. Unthrottled Routes & Non-Sensitive Endpoints', () => {
    it('should allow logout without throttling when marked with @SkipThrottle()', async () => {
      for (let i = 1; i <= 15; i++) {
        const res = await app.inject({
          method: 'POST',
          url: '/auth/logout',
          headers: { 'x-forwarded-for': '198.51.100.140' },
        });
        expect(res.statusCode).toBe(201);
      }
    });
  });

  describe('5. High-Concurrency Stress Test Against Same Target', () => {
    it('should enforce exact atomic limits under parallel concurrent login requests', async () => {
      const email = `concurrent-${Date.now()}@gramoz.com`;
      const ip = '198.51.100.150';
      const totalRequests = 10;

      const promises = Array.from({ length: totalRequests }).map((_, idx) =>
        app.inject({
          method: 'POST',
          url: '/auth/login',
          payload: { email, password: `Password${idx}!` },
          headers: { 'x-forwarded-for': ip },
        }),
      );

      const responses = await Promise.all(promises);

      const successful = responses.filter((r) => r.statusCode === 201);
      const rateLimited = responses.filter((r) => r.statusCode === 429);

      // Account limit is 5: exactly 5 requests must pass, 5 must be 429
      expect(successful.length).toBe(5);
      expect(rateLimited.length).toBe(5);

      // All 429s must return Retry-After header
      for (const limited of rateLimited) {
        expect(limited.headers['retry-after']).toBeDefined();
      }
    });
  });

  describe('6. Recovery & Reset After Expiration Window', () => {
    it('should allow successful login after an earlier failed attempt within limit', async () => {
      const email = `retry-success-${Date.now()}@gramoz.com`;
      const ip = '198.51.100.160';

      // First attempt fails with 401
      mockAuthService.login.mockRejectedValueOnce(
        new Error('Invalid credentials'),
      );
      const failRes = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email, password: 'WrongPassword!' },
        headers: { 'x-forwarded-for': ip },
      });
      expect(failRes.statusCode).toBe(500); // or 401 depending on exception

      // Second attempt succeeds with correct password
      mockAuthService.login.mockResolvedValueOnce({
        success: true,
        message: 'Login successful',
        data: {
          user: { id: 'u1', email, role: 'customer' },
          accessToken: 'token',
          refreshToken: 'refresh',
        },
      });

      const successRes = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email, password: 'CorrectPassword123!' },
        headers: { 'x-forwarded-for': ip },
      });
      expect(successRes.statusCode).toBe(201);
    });

    it('should reset limits after Redis counter TTL expires', async () => {
      const email = `ttl-expiry-${Date.now()}@gramoz.com`;
      const ip = '198.51.100.170';

      // 5 requests allowed
      for (let i = 1; i <= 5; i++) {
        const res = await app.inject({
          method: 'POST',
          url: '/auth/login',
          payload: { email, password: 'Password123!' },
          headers: { 'x-forwarded-for': ip },
        });
        expect(res.statusCode).toBe(201);
      }

      // 6th blocked
      const blockedRes = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email, password: 'Password123!' },
        headers: { 'x-forwarded-for': ip },
      });
      expect(blockedRes.statusCode).toBe(429);

      // Clean up Redis throttler keys to simulate window expiry
      const keys = await redisClient.keys('*throttle:*');
      if (keys.length > 0) {
        await redisClient.del(...keys);
      }

      // Subsequent attempt succeeds without 429
      const resetRes = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email, password: 'Password123!' },
        headers: { 'x-forwarded-for': ip },
      });
      expect(resetRes.statusCode).toBe(201);
    });
  });

  describe('7. Multi-Instance Cluster Consistency (Distributed Shared Counter)', () => {
    it('should share rate-limit counters across simulated distinct backend instances via Redis', async () => {
      // Simulate Instance B sharing the exact same Redis storage adapter
      const instanceBStorage = new ThrottlerStorageRedisService(redisClient);

      const moduleB: TestingModule = await Test.createTestingModule({
        imports: [
          ThrottlerModule.forRootAsync({
            useFactory: () => ({
              throttlers: [
                { name: 'default', ttl: 60_000, limit: 10 },
                {
                  name: 'account',
                  ttl: 60_000,
                  limit: 5,
                  getTracker: (req) =>
                    normalizeAccountIdentifier(req?.body) || 'anonymous',
                },
              ],
              storage: instanceBStorage,
            }),
          }),
        ],
        controllers: [AuthController],
        providers: [
          { provide: AuthService, useValue: mockAuthService },
          { provide: ConfigService, useValue: mockConfigService },
          { provide: APP_GUARD, useClass: AppThrottlerGuard },
        ],
      }).compile();

      const appB = moduleB.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter({ trustProxy: 1 }),
      );
      await appB.register(cookie as any, { secret: 'test-secret' });
      appB.useGlobalPipes(new ValidationPipe({ whitelist: true }));
      appB.useGlobalFilters(new AllExceptionsFilter());
      await appB.init();
      await appB.getHttpAdapter().getInstance().ready();

      const email = `cluster-${Date.now()}@gramoz.com`;

      // 3 requests to Instance A
      for (let i = 1; i <= 3; i++) {
        const resA = await app.inject({
          method: 'POST',
          url: '/auth/login',
          payload: { email, password: 'ClusterPassword1!' },
          headers: { 'x-forwarded-for': `198.51.100.${i}` },
        });
        expect(resA.statusCode).toBe(201);
      }

      // 2 requests to Instance B (total hits = 5)
      for (let i = 4; i <= 5; i++) {
        const resB = await appB.inject({
          method: 'POST',
          url: '/auth/login',
          payload: { email, password: 'ClusterPassword2!' },
          headers: { 'x-forwarded-for': `198.51.100.${i}` },
        });
        expect(resB.statusCode).toBe(201);
      }

      // 6th request to Instance B -> must be blocked because Instance A and B share Redis!
      const blockedResB = await appB.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email, password: 'ClusterPassword3!' },
        headers: { 'x-forwarded-for': '198.51.100.6' },
      });

      expect(blockedResB.statusCode).toBe(429);
      expect(blockedResB.headers['retry-after']).toBeDefined();

      instanceBStorage.onModuleDestroy();
      await appB.close();
    });
  });

  describe('8. Redis Outage Resilience & Fail Policy', () => {
    it('should not throw HTTP 500 when Redis fails; executes fail-open to in-memory store', async () => {
      // Disconnected / invalid Redis instance
      const deadRedis = new Redis({
        host: '127.0.0.1',
        port: 59998,
        maxRetriesPerRequest: 0,
        connectTimeout: 200,
        retryStrategy: () => null,
        lazyConnect: true,
      });

      const fallbackStorage = new ThrottlerStorageRedisService(deadRedis);

      const moduleFallback: TestingModule = await Test.createTestingModule({
        imports: [
          ThrottlerModule.forRootAsync({
            useFactory: () => ({
              throttlers: [
                { name: 'default', ttl: 60_000, limit: 10 },
                {
                  name: 'account',
                  ttl: 60_000,
                  limit: 2,
                  getTracker: (req) =>
                    normalizeAccountIdentifier(req?.body) || 'anonymous',
                },
              ],
              storage: fallbackStorage,
            }),
          }),
        ],
        controllers: [AuthController],
        providers: [
          { provide: AuthService, useValue: mockAuthService },
          { provide: ConfigService, useValue: mockConfigService },
          { provide: APP_GUARD, useClass: AppThrottlerGuard },
        ],
      }).compile();

      const appFallback =
        moduleFallback.createNestApplication<NestFastifyApplication>(
          new FastifyAdapter({ trustProxy: 1 }),
        );
      await appFallback.register(cookie as any, { secret: 'test-secret' });
      appFallback.useGlobalFilters(new AllExceptionsFilter());
      await appFallback.init();
      await appFallback.getHttpAdapter().getInstance().ready();

      const email = `dead-redis-${Date.now()}@gramoz.com`;

      // Requests 1 through 5 succeed despite Redis down (fail-open in-memory fallback)
      for (let i = 1; i <= 5; i++) {
        const res = await appFallback.inject({
          method: 'POST',
          url: '/auth/login',
          payload: { email, password: 'Password123!' },
          headers: { 'x-forwarded-for': '198.51.100.200' },
        });
        expect(res.statusCode).toBe(201);
      }

      // 6th request throttled by in-memory fallback (account limit = 5 on login)
      const res6 = await appFallback.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email, password: 'Password123!' },
        headers: { 'x-forwarded-for': '198.51.100.200' },
      });
      expect(res6.statusCode).toBe(429);

      try {
        deadRedis.disconnect(false);
      } catch {
        // ignore
      }
      fallbackStorage.onModuleDestroy();
      await appFallback.close();
    });
  });
});
