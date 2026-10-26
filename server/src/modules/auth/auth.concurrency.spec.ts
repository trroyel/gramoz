/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
import { Test, TestingModule } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import cookie from '@fastify/cookie';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, sql } from 'drizzle-orm';
import Redis from 'ioredis';
import * as schema from '@database/schema';
import { DATABASE } from '@database/database.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@config/config.service';
import { UsersStore } from '../users/users.store';
import { RedisService } from '@cache/redis.service';
import { MailService } from '../notifications/mail.service';
import { SmsService } from '../notifications/sms.service';
import { AllExceptionsFilter } from '../../common/filters/all-exceptions.filter';

describe('Authentication & Identity Concurrency & Race Condition Verification (Real PostgreSQL 16 & Redis 7 — TASK-16)', () => {
  let app: NestFastifyApplication;
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
  const jwtSecret = 'concurrency-jwt-secret-at-least-32-chars-long!';
  const cookieSecret = 'concurrency-cookie-secret-at-least-32-chars!';

  const createdUserIds: string[] = [];

  function getErrorMessage(payload: string): string {
    try {
      const parsed = JSON.parse(payload);
      return (parsed.error?.message ?? parsed.message ?? '') as string;
    } catch {
      return payload;
    }
  }

  const mockMailService = {
    sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
    sendWelcomeEmail: jest.fn().mockResolvedValue(undefined),
    sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
  };

  const mockSmsService = {
    sendVerificationSms: jest.fn().mockResolvedValue(undefined),
    sendOrderShippedSms: jest.fn().mockResolvedValue(undefined),
    sendOrderDeliveredSms: jest.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    // 1. PostgreSQL 16
    pool = new Pool({
      connectionString: testDbUrl,
      connectionTimeoutMillis: 5000,
      max: 15,
    });
    db = drizzle(pool, { schema });

    // 2. Redis 7
    redisClient = new Redis({
      host: redisHost,
      port: redisPort,
      password: redisPass,
      maxRetriesPerRequest: 3,
    });

    const mockConfig: Partial<ConfigService> = {
      jwtSecret,
      jwtExpiresIn: '15m',
      jwtRefreshExpiresIn: '7d',
      cookieSecret,
      verifyEmailTokenExpiresIn: '4h',
      resetPasswordTokenExpiresIn: '1h',
      frontendUrl: 'http://localhost:3000',
    };

    redisService = new RedisService(mockConfig as ConfigService);
    (redisService as any).client = redisClient;

    usersStore = new UsersStore(db as any, redisService);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        PassportModule,
        JwtModule.register({
          secret: jwtSecret,
          signOptions: { expiresIn: '15m' },
        }),
      ],
      controllers: [AuthController],
      providers: [
        AuthService,
        JwtStrategy,
        { provide: DATABASE, useValue: db },
        { provide: UsersStore, useValue: usersStore },
        { provide: RedisService, useValue: redisService },
        { provide: MailService, useValue: mockMailService },
        { provide: SmsService, useValue: mockSmsService },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    const fastifyAdapter = new FastifyAdapter({ trustProxy: 1 });
    app =
      moduleFixture.createNestApplication<NestFastifyApplication>(
        fastifyAdapter,
      );

    await app.register(cookie as any, {
      secret: cookieSecret,
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
    try {
      if (createdUserIds.length > 0) {
        for (const uid of createdUserIds) {
          await redisClient.del(`auth:session:${uid}`);
          await redisClient.del(`{user:${uid}}:cache`);
          await redisClient.del(`{user:${uid}}:gen`);
          await redisClient.del(`{user:${uid}}:invalidated`);
        }
        await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [
          createdUserIds,
        ]);
      }
    } finally {
      await app.close();
      await redisClient.quit();
      await pool.end();
    }
  });

  describe('Race 1: Concurrent Registration with Identical Email', () => {
    it('simultaneously registers identical email across 5 concurrent requests: exactly 1 succeeds (201), 4 fail with 409 Conflict', async () => {
      const email = `concurrent-reg-${Date.now()}@gramoz.com`;
      const password = 'ConcurrentPassword123!';

      // Launch 5 simultaneous registration requests
      const requests = Array.from({ length: 5 }, (_, idx) =>
        app.inject({
          method: 'POST',
          url: '/auth/register',
          payload: {
            email,
            password,
            fullName: `Concurrent User ${idx}`,
          },
        }),
      );

      const results = await Promise.all(requests);
      const statusCodes = results.map((r) => r.statusCode);

      // Exactly 1 must be 201 Created
      const successCount = statusCodes.filter((code) => code === 201).length;
      expect(successCount).toBe(1);

      // Exactly 4 must be 409 Conflict
      const conflictCount = statusCodes.filter((code) => code === 409).length;
      expect(conflictCount).toBe(4);

      // Verify each 409 contains 'Email already registered'
      for (const res of results) {
        if (res.statusCode === 409) {
          expect(getErrorMessage(res.payload)).toContain(
            'Email already registered',
          );
        } else if (res.statusCode === 201) {
          const body = JSON.parse(res.payload);
          createdUserIds.push(body.data.id);
        }
      }

      // Assert PostgreSQL data integrity: exactly ONE row in database
      const rows = await db
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(schema.users)
        .where(eq(schema.users.email, email));

      expect(rows[0].count).toBe(1);
    });
  });

  describe('Race 2: Concurrent Logins for the Same User', () => {
    it('handles 5 simultaneous login requests without session corruption or server crash', async () => {
      const email = `concurrent-login-${Date.now()}@gramoz.com`;
      const password = 'ConcurrentLoginPass123!';

      // 1. Create user
      const reg = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          email,
          password,
          fullName: 'Concurrent Login User',
        },
      });
      expect(reg.statusCode).toBe(201);
      const userId = JSON.parse(reg.payload).data.id;
      createdUserIds.push(userId);

      // 2. Fire 5 concurrent logins
      const loginRequests = Array.from({ length: 5 }, () =>
        app.inject({
          method: 'POST',
          url: '/auth/login',
          payload: { email, password },
        }),
      );

      const results = await Promise.all(loginRequests);

      // All 5 must succeed with 201
      for (const res of results) {
        expect(res.statusCode).toBe(201);
        const parsed = JSON.parse(res.payload);
        expect(parsed.success).toBe(true);
        expect(parsed.data.accessToken).toBeDefined();
        expect(parsed.data.refreshToken).toBeDefined();
      }

      // Redis session key must be intact and non-empty
      const sessionToken = await redisClient.get(`auth:session:${userId}`);
      expect(sessionToken).toBeDefined();
      expect(typeof sessionToken).toBe('string');
      expect(sessionToken.length).toBeGreaterThan(20);
    });
  });

  describe('Race 3: Concurrent Token Refresh, Logout & Session Race Verification', () => {
    it('enforces single-use rotation under 2 simultaneous requests: exactly 1 succeeds (201), exactly 1 fails with 401', async () => {
      const email = `concurrent-ref2-${Date.now()}@gramoz.com`;
      const password = 'ConcurrentRefreshPass123!';

      const reg = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { email, password, fullName: 'Refresh 2-Way User' },
      });
      const userId = JSON.parse(reg.payload).data.id;
      createdUserIds.push(userId);

      const login = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email, password },
      });
      const refreshToken = JSON.parse(login.payload).data.refreshToken;

      // Fire 2 simultaneous refresh requests with the same token
      const refreshReqs = [
        app.inject({
          method: 'POST',
          url: '/auth/refresh',
          cookies: { refresh_token: refreshToken },
        }),
        app.inject({
          method: 'POST',
          url: '/auth/refresh',
          cookies: { refresh_token: refreshToken },
        }),
      ];

      const results = await Promise.all(refreshReqs);
      const statuses = results.map((r) => r.statusCode);

      // Single-use invariant: exactly ONE 201, exactly ONE 401
      const successCount = statuses.filter((s) => s === 201).length;
      const failureCount = statuses.filter((s) => s === 401).length;
      expect(successCount).toBe(1);
      expect(failureCount).toBe(1);

      // Extract winning token
      const winningRes = results.find((r) => r.statusCode === 201)!;
      const winningToken = JSON.parse(winningRes.payload).data.refreshToken;
      expect(winningToken).toBeDefined();
      expect(winningToken).not.toBe(refreshToken);

      // Extract losing response
      const losingRes = results.find((r) => r.statusCode === 401)!;
      expect(getErrorMessage(losingRes.payload)).toMatch(
        /Invalid or revoked refresh token|Invalid refresh token/,
      );

      // Verify Redis active session strictly holds the winner's token
      const activeSession = await redisClient.get(`auth:session:${userId}`);
      expect(activeSession).toBe(winningToken);
    });

    it('enforces single-use rotation under 10 simultaneous requests: exactly 1 succeeds (201), exactly 9 fail with 401', async () => {
      const email = `concurrent-ref10-${Date.now()}@gramoz.com`;
      const password = 'ConcurrentRefreshPass123!';

      const reg = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { email, password, fullName: 'Refresh 10-Way User' },
      });
      const userId = JSON.parse(reg.payload).data.id;
      createdUserIds.push(userId);

      const login = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email, password },
      });
      const refreshToken = JSON.parse(login.payload).data.refreshToken;

      // Fire 10 simultaneous refresh requests with the same token
      const requests = Array.from({ length: 10 }, () =>
        app.inject({
          method: 'POST',
          url: '/auth/refresh',
          cookies: { refresh_token: refreshToken },
        }),
      );

      const results = await Promise.all(requests);
      const statuses = results.map((r) => r.statusCode);

      // Single-use invariant: exactly ONE 201, exactly NINE 401
      const successCount = statuses.filter((s) => s === 201).length;
      const failureCount = statuses.filter((s) => s === 401).length;
      expect(successCount).toBe(1);
      expect(failureCount).toBe(9);

      // Winner's token is in Redis
      const winner = results.find((r) => r.statusCode === 201)!;
      const winningToken = JSON.parse(winner.payload).data.refreshToken;
      const sessionInRedis = await redisClient.get(`auth:session:${userId}`);
      expect(sessionInRedis).toBe(winningToken);
    });

    it('prevents refresh token replay: replayed token cannot rotate again and leaves active token intact', async () => {
      const email = `concurrent-replay-${Date.now()}@gramoz.com`;
      const password = 'ConcurrentRefreshPass123!';

      const reg = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { email, password, fullName: 'Replay User' },
      });
      const userId = JSON.parse(reg.payload).data.id;
      createdUserIds.push(userId);

      const login = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email, password },
      });
      const token1 = JSON.parse(login.payload).data.refreshToken;

      // First refresh: rotates token1 -> token2
      const firstRefresh = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        cookies: { refresh_token: token1 },
      });
      expect(firstRefresh.statusCode).toBe(201);
      const token2 = JSON.parse(firstRefresh.payload).data.refreshToken;

      // Replay attack: client attempts to use token1 again
      const replayAttempt = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        cookies: { refresh_token: token1 },
      });
      expect(replayAttempt.statusCode).toBe(401);

      // Active session in Redis MUST remain token2
      const currentSession = await redisClient.get(`auth:session:${userId}`);
      expect(currentSession).toBe(token2);
    });

    it('prevents stale token logout from revoking a newer rotated session (atomic CAD)', async () => {
      const email = `concurrent-cad-${Date.now()}@gramoz.com`;
      const password = 'ConcurrentRefreshPass123!';

      const reg = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { email, password, fullName: 'CAD User' },
      });
      const userId = JSON.parse(reg.payload).data.id;
      createdUserIds.push(userId);

      const login = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email, password },
      });
      const token1 = JSON.parse(login.payload).data.refreshToken;

      // Rotate token1 -> token2
      const refreshRes = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        cookies: { refresh_token: token1 },
      });
      expect(refreshRes.statusCode).toBe(201);
      const token2 = JSON.parse(refreshRes.payload).data.refreshToken;

      // Stale client possessing old token1 calls logout
      const staleLogoutRes = await app.inject({
        method: 'POST',
        url: '/auth/logout',
        cookies: { refresh_token: token1 },
      });
      expect(staleLogoutRes.statusCode).toBe(201);

      // Compare-And-Delete guarantee: active session in Redis MUST NOT be deleted because token1 != token2
      const sessionAfterStaleLogout = await redisClient.get(
        `auth:session:${userId}`,
      );
      expect(sessionAfterStaleLogout).toBe(token2);

      // The active client with token2 can still successfully refresh
      const subsequentRefresh = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        cookies: { refresh_token: token2 },
      });
      expect(subsequentRefresh.statusCode).toBe(201);
    });

    it('handles refresh racing simultaneously with logout without corruption or server crash', async () => {
      const email = `concurrent-race-logout-${Date.now()}@gramoz.com`;
      const password = 'ConcurrentRefreshPass123!';

      const reg = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { email, password, fullName: 'Race Logout User' },
      });
      const userId = JSON.parse(reg.payload).data.id;
      createdUserIds.push(userId);

      const login = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email, password },
      });
      const token = JSON.parse(login.payload).data.refreshToken;

      // Launch refresh and logout simultaneously with the same token
      const [refreshRes, logoutRes] = await Promise.all([
        app.inject({
          method: 'POST',
          url: '/auth/refresh',
          cookies: { refresh_token: token },
        }),
        app.inject({
          method: 'POST',
          url: '/auth/logout',
          cookies: { refresh_token: token },
        }),
      ]);

      // Logout always succeeds and clears client cookies
      expect(logoutRes.statusCode).toBe(201);

      // Refresh either succeeds (ran before logout) or fails with 401 (ran after logout deleted session)
      expect([201, 401]).toContain(refreshRes.statusCode);

      // In either outcome, state in Redis is clean:
      // If logout won CAD on the original token, session is null.
      // If refresh won CAS, then logout with old token did NOT delete new token (CAD preserved new token).
      // If logout won, session is null.
      const finalSession = await redisClient.get(`auth:session:${userId}`);
      if (refreshRes.statusCode === 201) {
        // Refresh rotated to token2 before logout executed with token1.
        // Because logout had old token1, CAD protected token2!
        const newRefreshToken = JSON.parse(refreshRes.payload).data
          .refreshToken;
        expect(finalSession).toBe(newRefreshToken);
      } else {
        // Logout executed first and deleted token from Redis; refresh was rejected.
        expect(finalSession).toBeNull();
      }
    });

    it('repeated logout requests are idempotent and do not crash or corrupt Redis', async () => {
      const email = `concurrent-rep-logout-${Date.now()}@gramoz.com`;
      const password = 'ConcurrentRefreshPass123!';

      const reg = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { email, password, fullName: 'Repeat Logout User' },
      });
      const userId = JSON.parse(reg.payload).data.id;
      createdUserIds.push(userId);

      const login = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email, password },
      });
      const token = JSON.parse(login.payload).data.refreshToken;

      // Fire 5 repeated logout requests concurrently
      const logoutReqs = Array.from({ length: 5 }, () =>
        app.inject({
          method: 'POST',
          url: '/auth/logout',
          cookies: { refresh_token: token },
        }),
      );

      const results = await Promise.all(logoutReqs);
      for (const res of results) {
        expect(res.statusCode).toBe(201);
        expect(JSON.parse(res.payload).success).toBe(true);
      }

      // Redis session is gone
      const session = await redisClient.get(`auth:session:${userId}`);
      expect(session).toBeNull();
    });
  });

  describe('Race 4: Concurrent Brute Force OTP Racing Against Lockout Ceiling', () => {
    it('atomically enforces 5-attempt ceiling and invalidates OTP under 10 concurrent requests', async () => {
      const email = `concurrent-otp-${Date.now()}@gramoz.com`;
      const password = 'ConcurrentOtpPass123!';

      const reg = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { email, password, fullName: 'OTP Storm User' },
      });
      const userId = JSON.parse(reg.payload).data.id;
      createdUserIds.push(userId);

      // Get real OTP
      const realOtp = await redisClient.get(`auth:verify:${email}`);
      expect(realOtp).toBeDefined();

      // Launch 10 simultaneous invalid verification requests
      const stormRequests = Array.from({ length: 10 }, () =>
        app.inject({
          method: 'POST',
          url: '/auth/verify-email',
          payload: { email, code: '00000000' }, // invalid code
        }),
      );

      const stormResults = await Promise.all(stormRequests);

      // All attempts must be rejected with 400
      for (const res of stormResults) {
        expect(res.statusCode).toBe(400);
      }

      // After 10 concurrent failures, the OTP in Redis MUST be purged/destroyed
      const remainingOtp = await redisClient.get(`auth:verify:${email}`);
      expect(remainingOtp).toBeNull();

      // A subsequent attempt even with the REAL code must now be rejected
      const finalAttempt = await app.inject({
        method: 'POST',
        url: '/auth/verify-email',
        payload: { email, code: realOtp },
      });

      expect(finalAttempt.statusCode).toBe(400);
      expect(getErrorMessage(finalAttempt.payload)).toMatch(
        /Too many failed attempts|expired or invalid/,
      );
    });
  });
});
