/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { Test, TestingModule } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import cookie from '@fastify/cookie';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import Redis from 'ioredis';
import * as jwt from 'jsonwebtoken';
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
import { UsersAdminController } from '../users/users-admin.controller';
import { UsersAdminService } from '../users/users-admin.service';
import { AllExceptionsFilter } from '../../common/filters/all-exceptions.filter';
import { Role } from '@database/schema/enums';

describe('Comprehensive Authentication, Identity & RBAC Integration (Real PostgreSQL 16 & Redis 7 — TASK-16)', () => {
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
  const jwtSecret = 'test-jwt-secret-at-least-32-chars-long-1234!';
  const cookieSecret = 'test-cookie-secret-at-least-32-chars-5678!';

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
    // 1. Connect real PostgreSQL 16
    pool = new Pool({
      connectionString: testDbUrl,
      connectionTimeoutMillis: 5000,
      max: 10,
    });
    db = drizzle(pool, { schema });

    // 2. Connect real Redis 7
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
      googleClientId: 'mock-google-id',
      googleClientSecret: 'mock-google-secret',
      googleCallbackUrl: 'http://localhost:4000/auth/google/callback',
      facebookAppId: 'mock-fb-id',
      facebookAppSecret: 'mock-fb-secret',
      facebookCallbackUrl: 'http://localhost:4000/auth/facebook/callback',
    };

    redisService = new RedisService(mockConfig as ConfigService);
    // Bind the connected real redis client into redisService
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
      controllers: [AuthController, UsersAdminController],
      providers: [
        AuthService,
        JwtStrategy,
        UsersAdminService,
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

  describe('1. Registration, Email Verification & OTP Brute-Force Protection', () => {
    const regEmail = `test-reg-${Date.now()}@gramoz.com`;

    it('successfully registers customer with Argon2 hash and records verification OTP in Redis (B-AUTH-01)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          email: regEmail,
          password: 'Password123!',
          fullName: 'Jane Customer',
          phone: '+8801700000001',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(body.data.email).toBe(regEmail);
      expect(body.data).not.toHaveProperty('passwordHash');

      const userId = body.data.id;
      createdUserIds.push(userId);

      // Verify user in PostgreSQL
      const [dbUser] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, userId));
      expect(dbUser).toBeDefined();
      expect(dbUser.passwordHash).toMatch(/^\$argon2id\$/);
      expect(dbUser.isEmailVerified).toBe(false);

      // Verify OTP stored in real Redis
      const redisOtp = await redisClient.get(`auth:verify:${regEmail}`);
      expect(redisOtp).toBeDefined();
      expect(redisOtp).toHaveLength(8);
    });

    it('rejects registration with duplicate email with 409 Conflict (B-AUTH-02)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          email: regEmail,
          password: 'Password123!',
          fullName: 'Duplicate Customer',
        },
      });

      expect(res.statusCode).toBe(409);
      expect(getErrorMessage(res.payload)).toContain(
        'Email already registered',
      );
    });

    it('enforces brute force lockout on email OTP after 5 failed attempts (B-AUTH-08)', async () => {
      // 5 failed verification attempts
      for (let i = 1; i <= 5; i++) {
        const failRes = await app.inject({
          method: 'POST',
          url: '/auth/verify-email',
          payload: { email: regEmail, code: '00000000' },
        });
        expect(failRes.statusCode).toBe(400);
      }

      // 6th attempt with the REAL code from Redis should be rejected because code is invalidated
      const realOtp = await redisClient.get(`auth:verify:${regEmail}`);
      const sixthRes = await app.inject({
        method: 'POST',
        url: '/auth/verify-email',
        payload: { email: regEmail, code: realOtp || '12345678' },
      });

      expect(sixthRes.statusCode).toBe(400);
      expect(getErrorMessage(sixthRes.payload)).toContain(
        'Too many failed attempts',
      );

      // Assert code was destroyed in Redis
      const deletedOtp = await redisClient.get(`auth:verify:${regEmail}`);
      expect(deletedOtp).toBeNull();
    });

    it('successfully verifies email with fresh code and updates isEmailVerified in PostgreSQL (B-AUTH-07)', async () => {
      // Resend a fresh code
      const resendRes = await app.inject({
        method: 'POST',
        url: '/auth/resend-verification',
        payload: { email: regEmail },
      });
      expect(resendRes.statusCode).toBe(201);

      const freshOtp = await redisClient.get(`auth:verify:${regEmail}`);
      expect(freshOtp).toBeDefined();

      const verifyRes = await app.inject({
        method: 'POST',
        url: '/auth/verify-email',
        payload: { email: regEmail, code: freshOtp },
      });

      expect(verifyRes.statusCode).toBe(201);
      const body = JSON.parse(verifyRes.payload);
      expect(body.success).toBe(true);

      // Verify PostgreSQL isEmailVerified is true
      const [updated] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, regEmail));
      expect(updated.isEmailVerified).toBe(true);
    });
  });

  describe('2. Login, Cookie Security & User Enumeration Defense', () => {
    let customerId: string;
    const loginEmail = `login-${Date.now()}@gramoz.com`;
    const password = 'CorrectPassword123!';

    beforeAll(async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          email: loginEmail,
          password,
          fullName: 'Login User',
        },
      });
      customerId = JSON.parse(res.payload).data.id;
      createdUserIds.push(customerId);
    });

    it('logs in successfully and sets httpOnly secure cookies and Redis session (B-AUTH-03)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: loginEmail, password },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(body.data.accessToken).toBeDefined();
      expect(body.data.refreshToken).toBeDefined();

      // Verify Set-Cookie headers
      const setCookies = res.headers['set-cookie'];
      expect(setCookies).toBeDefined();
      const cookieStr = Array.isArray(setCookies)
        ? setCookies.join('; ')
        : setCookies;
      expect(cookieStr).toContain('access_token=');
      expect(cookieStr).toContain('refresh_token=');
      expect(cookieStr).toContain('HttpOnly');
      expect(cookieStr).toContain('SameSite=Strict');

      // Verify session stored in real Redis
      const redisSession = await redisClient.get(`auth:session:${customerId}`);
      expect(redisSession).toBe(body.data.refreshToken);
    });

    it('rejects wrong password with 401 Unauthorized without setting cookies (B-AUTH-04)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: loginEmail, password: 'WrongPassword999!' },
      });

      expect(res.statusCode).toBe(401);
      expect(getErrorMessage(res.payload)).toBe('Invalid credentials');
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('rejects unknown email with 401 Unauthorized (Zero Enumeration)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          email: 'nonexistent-account@gramoz.com',
          password: 'SomePassword!',
        },
      });

      expect(res.statusCode).toBe(401);
      expect(getErrorMessage(res.payload)).toBe('Invalid credentials');
    });

    it('DEFECT FIX: rejects login on OAuth user (null passwordHash) with 401 instead of crashing with 500', async () => {
      const oauthEmail = `oauth-user-${Date.now()}@google.com`;
      const [oauthUser] = await db
        .insert(schema.users)
        .values({
          email: oauthEmail,
          fullName: 'OAuth Google User',
          passwordHash: null, // OAuth user with no password set
          provider: 'google',
          providerId: 'google-uid-12345',
          status: 'active',
        })
        .returning();
      createdUserIds.push(oauthUser.id);

      const res = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: oauthEmail, password: 'AnyPasswordAttempt!' },
      });

      // Must be clean 401, NOT unhandled 500
      expect(res.statusCode).toBe(401);
      expect(getErrorMessage(res.payload)).toBe('Invalid credentials');
    });

    it('rejects login with 401 when user status is suspended', async () => {
      await db
        .update(schema.users)
        .set({ status: 'suspended' })
        .where(eq(schema.users.id, customerId));

      const res = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: loginEmail, password },
      });

      expect(res.statusCode).toBe(401);
      expect(getErrorMessage(res.payload)).toContain(
        'Account is suspended or deleted',
      );

      // Restore active
      await db
        .update(schema.users)
        .set({ status: 'active' })
        .where(eq(schema.users.id, customerId));
    });
  });

  describe('3. Token Refresh, Logout & Session Invalidation (B-AUTH-05, B-AUTH-06)', () => {
    let testUserId: string;
    let refreshToken: string;
    const sessionEmail = `session-${Date.now()}@gramoz.com`;

    beforeAll(async () => {
      const reg = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          email: sessionEmail,
          password: 'Password123!',
          fullName: 'Session User',
        },
      });
      testUserId = JSON.parse(reg.payload).data.id;
      createdUserIds.push(testUserId);

      const login = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: sessionEmail, password: 'Password123!' },
      });
      refreshToken = JSON.parse(login.payload).data.refreshToken;
    });

    it('refreshes token successfully via refresh_token cookie and emits rotated tokens (B-AUTH-05)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        cookies: {
          refresh_token: refreshToken,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(body.data.accessToken).toBeDefined();
      expect(body.data.refreshToken).toBeDefined();

      // Verify Redis session was updated to the new token
      const newSession = await redisClient.get(`auth:session:${testUserId}`);
      expect(newSession).toBe(body.data.refreshToken);

      // Update refreshToken handle for subsequent tests
      refreshToken = body.data.refreshToken;
    });

    it('POST /auth/logout clears cookies AND revokes Redis session (B-AUTH-06)', async () => {
      const logoutRes = await app.inject({
        method: 'POST',
        url: '/auth/logout',
        cookies: {
          refresh_token: refreshToken,
        },
      });

      expect(logoutRes.statusCode).toBe(201);
      const body = JSON.parse(logoutRes.payload);
      expect(body.success).toBe(true);

      // Check client cookies cleared
      const setCookies = logoutRes.headers['set-cookie'];
      const cookieStr = Array.isArray(setCookies)
        ? setCookies.join('; ')
        : setCookies;
      expect(cookieStr).toContain('access_token=;');
      expect(cookieStr).toContain('refresh_token=;');

      // Check session completely purged from Redis
      const revokedSession = await redisClient.get(
        `auth:session:${testUserId}`,
      );
      expect(revokedSession).toBeNull();

      // Subsequent refresh attempt with old token must be immediately rejected with 401
      const refreshAttempt = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        cookies: {
          refresh_token: refreshToken,
        },
      });

      expect(refreshAttempt.statusCode).toBe(401);
      expect(getErrorMessage(refreshAttempt.payload)).toContain(
        'Invalid refresh token',
      );
    });

    it('rejects refresh when token is expired (401)', async () => {
      const expiredToken = jwt.sign(
        {
          sub: testUserId,
          email: sessionEmail,
          role: 'customer',
          token_type: 'refresh',
        },
        jwtSecret,
        { expiresIn: '-10s' },
      );

      const res = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        cookies: { refresh_token: expiredToken },
      });

      expect(res.statusCode).toBe(401);
      expect(getErrorMessage(res.payload)).toMatch(/Invalid refresh token/);
    });

    it('rejects refresh when JWT signature is invalid/tampered (401)', async () => {
      const forgedToken = jwt.sign(
        {
          sub: testUserId,
          email: sessionEmail,
          role: 'customer',
          token_type: 'refresh',
        },
        'wrong-secret-key-that-does-not-match-gramoz!',
        { expiresIn: '7d' },
      );

      const res = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        cookies: { refresh_token: forgedToken },
      });

      expect(res.statusCode).toBe(401);
      expect(getErrorMessage(res.payload)).toMatch(/Invalid refresh token/);
    });

    it('rejects refresh when token is malformed string (401)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        cookies: { refresh_token: 'not-a-valid-jwt-token' },
      });

      expect(res.statusCode).toBe(401);
      expect(getErrorMessage(res.payload)).toMatch(/Invalid refresh token/);
    });

    it('rejects refresh when Redis session is missing (401)', async () => {
      const validJwtNoSession = jwt.sign(
        {
          sub: testUserId,
          email: sessionEmail,
          role: 'customer',
          token_type: 'refresh',
        },
        jwtSecret,
        { expiresIn: '7d' },
      );
      // Ensure Redis session does not exist
      await redisClient.del(`auth:session:${testUserId}`);

      const res = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        cookies: { refresh_token: validJwtNoSession },
      });

      expect(res.statusCode).toBe(401);
      expect(getErrorMessage(res.payload)).toMatch(/Invalid refresh token/);
    });

    it('rejects refresh when access token is presented as refresh token (token type confusion) (401)', async () => {
      const accessToken = jwt.sign(
        {
          sub: testUserId,
          email: sessionEmail,
          role: 'customer',
          token_type: 'access',
        },
        jwtSecret,
        { expiresIn: '15m' },
      );

      const res = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        cookies: { refresh_token: accessToken },
      });

      expect(res.statusCode).toBe(401);
      expect(getErrorMessage(res.payload)).toMatch(/Invalid refresh token/);
    });

    it('POST /auth/logout with access token clears cookies but does NOT delete active Redis session', async () => {
      const activeRefresh = jwt.sign(
        {
          sub: testUserId,
          email: sessionEmail,
          role: 'customer',
          token_type: 'refresh',
          jti: 'test-jti-1',
        },
        jwtSecret,
        { expiresIn: '7d' },
      );
      await redisClient.setex(
        `auth:session:${testUserId}`,
        7 * 24 * 60 * 60,
        activeRefresh,
      );

      const accessToken = jwt.sign(
        {
          sub: testUserId,
          email: sessionEmail,
          role: 'customer',
          token_type: 'access',
        },
        jwtSecret,
        { expiresIn: '15m' },
      );

      const res = await app.inject({
        method: 'POST',
        url: '/auth/logout',
        cookies: { refresh_token: accessToken },
      });

      expect(res.statusCode).toBe(201);
      // Active refresh token in Redis MUST NOT be deleted
      const sessionAfterLogout = await redisClient.get(
        `auth:session:${testUserId}`,
      );
      expect(sessionAfterLogout).toBe(activeRefresh);
    });

    it('POST /auth/logout with forged signature cannot delete another user session in Redis', async () => {
      const activeRefresh = jwt.sign(
        {
          sub: testUserId,
          email: sessionEmail,
          role: 'customer',
          token_type: 'refresh',
          jti: 'test-jti-2',
        },
        jwtSecret,
        { expiresIn: '7d' },
      );
      await redisClient.setex(
        `auth:session:${testUserId}`,
        7 * 24 * 60 * 60,
        activeRefresh,
      );

      const forgedToken = jwt.sign(
        {
          sub: testUserId,
          email: sessionEmail,
          role: 'customer',
          token_type: 'refresh',
        },
        'attacker-signature-key-does-not-match!',
        { expiresIn: '7d' },
      );

      const res = await app.inject({
        method: 'POST',
        url: '/auth/logout',
        cookies: { refresh_token: forgedToken },
      });

      expect(res.statusCode).toBe(201);
      // Victim's session in Redis MUST remain untouched
      const session = await redisClient.get(`auth:session:${testUserId}`);
      expect(session).toBe(activeRefresh);
    });

    it('cross-user session isolation: token for User A cannot rotate User B session', async () => {
      const [userB] = await db
        .insert(schema.users)
        .values({
          email: `user-b-${Date.now()}@gramoz.com`,
          fullName: 'User B',
          role: 'customer',
          status: 'active',
        })
        .returning();
      createdUserIds.push(userB.id);

      const tokenB = jwt.sign(
        {
          sub: userB.id,
          email: userB.email,
          role: 'customer',
          token_type: 'refresh',
        },
        jwtSecret,
        { expiresIn: '7d' },
      );
      await redisClient.setex(
        `auth:session:${userB.id}`,
        7 * 24 * 60 * 60,
        tokenB,
      );

      const tokenA = jwt.sign(
        {
          sub: testUserId,
          email: sessionEmail,
          role: 'customer',
          token_type: 'refresh',
        },
        jwtSecret,
        { expiresIn: '7d' },
      );

      await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        cookies: { refresh_token: tokenA },
      });

      // User B's session in Redis is completely isolated and unchanged
      const sessionB = await redisClient.get(`auth:session:${userB.id}`);
      expect(sessionB).toBe(tokenB);
    });
  });

  describe('4. Protected Endpoint Identity & Anti-Header-Spoofing (/auth/me)', () => {
    let userToken: string;
    let userId: string;

    beforeAll(async () => {
      const [u] = await db
        .insert(schema.users)
        .values({
          email: `me-${Date.now()}@gramoz.com`,
          fullName: 'Profile User',
          role: 'customer',
          status: 'active',
        })
        .returning();
      userId = u.id;
      createdUserIds.push(userId);

      userToken = jwt.sign(
        { sub: userId, email: u.email, role: 'customer', token_type: 'access' },
        jwtSecret,
        { expiresIn: '15m' },
      );
    });

    it('Scenario 1: allows access to /auth/me via typed access token in httpOnly cookie (200)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/auth/me',
        cookies: {
          access_token: userToken,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.data.id).toBe(userId);
      expect(body.data).not.toHaveProperty('passwordHash');
    });

    it('Scenario 1: allows access to /auth/me via typed access token in Bearer header (200)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: {
          authorization: `Bearer ${userToken}`,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload).data.id).toBe(userId);
    });

    it('Scenario 2: rejects access to /auth/me when typed refresh token is presented (HTTP 401)', async () => {
      const typedRefreshToken = jwt.sign(
        {
          sub: userId,
          email: 'me-user@gramoz.com',
          role: 'customer',
          token_type: 'refresh',
          jti: crypto.randomUUID(),
        },
        jwtSecret,
        { expiresIn: '7d' },
      );

      const res = await app.inject({
        method: 'GET',
        url: '/auth/me',
        cookies: {
          access_token: typedRefreshToken,
        },
      });

      expect(res.statusCode).toBe(401);
      expect(getErrorMessage(res.payload)).toContain(
        'Invalid or missing token type; access token required',
      );
    });

    it('Scenario 3: rejects access to /auth/me when JWT lacks token_type claim (HTTP 401)', async () => {
      const untypedJwt = jwt.sign(
        {
          sub: userId,
          email: 'me-user@gramoz.com',
          role: 'customer',
        },
        jwtSecret,
        { expiresIn: '15m' },
      );

      const res = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: {
          authorization: `Bearer ${untypedJwt}`,
        },
      });

      expect(res.statusCode).toBe(401);
      expect(getErrorMessage(res.payload)).toContain(
        'Invalid or missing token type; access token required',
      );
    });

    it('Scenario 4: rejects access to /auth/me when legacy pre-TASK-16F 7-day refresh token is used as Bearer (HTTP 401)', async () => {
      const legacyRefreshToken = jwt.sign(
        {
          sub: userId,
          email: 'me-user@gramoz.com',
          role: 'customer',
          jti: crypto.randomUUID(),
        },
        jwtSecret,
        { expiresIn: '7d' },
      );

      const res = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: {
          authorization: `Bearer ${legacyRefreshToken}`,
        },
      });

      expect(res.statusCode).toBe(401);
      expect(getErrorMessage(res.payload)).toContain(
        'Invalid or missing token type; access token required',
      );
    });

    it('Scenario 5: rejects access to /auth/me when legacy refresh token is used as access_token cookie (HTTP 401)', async () => {
      const legacyRefreshToken = jwt.sign(
        {
          sub: userId,
          email: 'me-user@gramoz.com',
          role: 'customer',
          jti: crypto.randomUUID(),
        },
        jwtSecret,
        { expiresIn: '7d' },
      );

      const res = await app.inject({
        method: 'GET',
        url: '/auth/me',
        cookies: {
          access_token: legacyRefreshToken,
        },
      });

      expect(res.statusCode).toBe(401);
      expect(getErrorMessage(res.payload)).toContain(
        'Invalid or missing token type; access token required',
      );
    });

    it('Scenario 6: rejects access when token has unknown or malformed token_type (HTTP 401)', async () => {
      const malformedTypeToken = jwt.sign(
        {
          sub: userId,
          email: 'me-user@gramoz.com',
          role: 'customer',
          token_type: 'identity_v1',
        },
        jwtSecret,
        { expiresIn: '15m' },
      );

      const res = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: {
          authorization: `Bearer ${malformedTypeToken}`,
        },
      });

      expect(res.statusCode).toBe(401);
      expect(getErrorMessage(res.payload)).toContain(
        'Invalid or missing token type; access token required',
      );
    });

    it('Scenario 7: rejects access when token has invalid signature (HTTP 401)', async () => {
      const forgedToken = jwt.sign(
        {
          sub: userId,
          email: 'me-user@gramoz.com',
          role: 'customer',
          token_type: 'access',
        },
        'wrong-forged-secret-32-chars-long!',
        { expiresIn: '15m' },
      );

      const res = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: {
          authorization: `Bearer ${forgedToken}`,
        },
      });

      expect(res.statusCode).toBe(401);
    });

    it('Scenario 8: rejects access when token is expired (HTTP 401)', async () => {
      const expiredToken = jwt.sign(
        {
          sub: userId,
          email: 'me-user@gramoz.com',
          role: 'customer',
          token_type: 'access',
        },
        jwtSecret,
        { expiresIn: '-1s' },
      );

      const res = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: {
          authorization: `Bearer ${expiredToken}`,
        },
      });

      expect(res.statusCode).toBe(401);
    });

    it('rejects unauthenticated request to /auth/me with 401 Unauthorized', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/auth/me',
      });

      expect(res.statusCode).toBe(401);
    });

    it('ANTI-SPOOFING: rejects forged identity headers (x-user-id, x-user-role) without valid token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: {
          'x-user-id': 'admin-uuid',
          'x-user-role': 'admin',
          'x-user-email': 'admin@gramoz.com',
        },
      });

      expect(res.statusCode).toBe(401);
    });
  });

  describe('5. RBAC & Authoritative Security Gate (/admin/users)', () => {
    let customerToken: string;
    let adminToken: string;
    let adminUserId: string;

    beforeAll(async () => {
      // 1. Create customer
      const [cust] = await db
        .insert(schema.users)
        .values({
          email: `rbac-cust-${Date.now()}@gramoz.com`,
          fullName: 'RBAC Customer',
          role: Role.CUSTOMER,
          status: 'active',
        })
        .returning();
      createdUserIds.push(cust.id);
      customerToken = jwt.sign(
        {
          sub: cust.id,
          email: cust.email,
          role: Role.CUSTOMER,
          token_type: 'access',
        },
        jwtSecret,
        { expiresIn: '15m' },
      );

      // 2. Create admin
      const [adm] = await db
        .insert(schema.users)
        .values({
          email: `rbac-admin-${Date.now()}@gramoz.com`,
          fullName: 'RBAC Admin',
          role: Role.ADMIN,
          status: 'active',
        })
        .returning();
      adminUserId = adm.id;
      createdUserIds.push(adm.id);
      adminToken = jwt.sign(
        {
          sub: adm.id,
          email: adm.email,
          role: Role.ADMIN,
          token_type: 'access',
        },
        jwtSecret,
        { expiresIn: '15m' },
      );
    });

    it('Scenario 10: rejects legacy admin token lacking token_type from accessing /admin/users (HTTP 401)', async () => {
      const legacyAdminToken = jwt.sign(
        { sub: adminUserId, email: 'rbac-admin@gramoz.com', role: Role.ADMIN },
        jwtSecret,
        { expiresIn: '15m' },
      );

      const res = await app.inject({
        method: 'GET',
        url: '/admin/users',
        headers: {
          authorization: `Bearer ${legacyAdminToken}`,
        },
      });

      expect(res.statusCode).toBe(401);
      expect(getErrorMessage(res.payload)).toContain(
        'Invalid or missing token type; access token required',
      );
    });

    it('Scenario 10: rejects legacy admin 7-day refresh token from accessing /admin/users (HTTP 401)', async () => {
      const legacyAdminRefreshToken = jwt.sign(
        {
          sub: adminUserId,
          email: 'rbac-admin@gramoz.com',
          role: Role.ADMIN,
          jti: crypto.randomUUID(),
        },
        jwtSecret,
        { expiresIn: '7d' },
      );

      const res = await app.inject({
        method: 'GET',
        url: '/admin/users',
        headers: {
          authorization: `Bearer ${legacyAdminRefreshToken}`,
        },
      });

      expect(res.statusCode).toBe(401);
      expect(getErrorMessage(res.payload)).toContain(
        'Invalid or missing token type; access token required',
      );
    });

    it('rejects customer token from accessing /admin/users with 403 Forbidden (B-AUTH-13)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/admin/users',
        headers: {
          authorization: `Bearer ${customerToken}`,
        },
      });

      expect(res.statusCode).toBe(403);
      expect(getErrorMessage(res.payload)).toContain('Access denied');
    });

    it('allows verified admin access to /admin/users with 200 OK', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/admin/users',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload).success).toBe(true);
    });

    it('AUTHORITATIVE DB GATE: demoted admin is immediately blocked with 403 with 0s stale window', async () => {
      // Demote admin to customer directly in PostgreSQL
      await db
        .update(schema.users)
        .set({ role: Role.CUSTOMER })
        .where(eq(schema.users.id, adminUserId));

      try {
        // Admin uses their unexpired Admin JWT token
        const res = await app.inject({
          method: 'GET',
          url: '/admin/users',
          headers: {
            authorization: `Bearer ${adminToken}`,
          },
        });

        // Must be immediately rejected with 403 Forbidden
        expect(res.statusCode).toBe(403);
        expect(getErrorMessage(res.payload)).toContain('Access denied');
      } finally {
        // Restore admin role and invalidate cache
        await usersStore.update(adminUserId, { role: Role.ADMIN as any });
      }
    });

    it('SELF-MODIFICATION PREVENTION: admin cannot suspend their own account via PATCH /admin/users/:id/status', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/admin/users/${adminUserId}/status`,
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: { status: 'suspended' },
      });

      expect(res.statusCode).toBe(400);
      expect(getErrorMessage(res.payload)).toContain(
        'You cannot suspend or delete your own account',
      );
    });
  });

  describe('6. Password Reset Flow (B-AUTH-11)', () => {
    const resetEmail = `reset-${Date.now()}@gramoz.com`;
    let resetUserId: string;

    beforeAll(async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          email: resetEmail,
          password: 'OldPassword123!',
          fullName: 'Reset User',
        },
      });
      resetUserId = JSON.parse(res.payload).data.id;
      createdUserIds.push(resetUserId);
    });

    it('forgot-password sends code to Redis and returns neutral response', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/forgot-password',
        payload: { email: resetEmail },
      });

      expect(res.statusCode).toBe(201);
      const code = await redisClient.get(`auth:reset:${resetEmail}`);
      expect(code).toBeDefined();
      expect(code).toHaveLength(8);
    });

    it('reset-password changes password hash and invalidates old credentials in login', async () => {
      const resetCode = await redisClient.get(`auth:reset:${resetEmail}`);
      expect(resetCode).toBeDefined();

      const resetRes = await app.inject({
        method: 'POST',
        url: '/auth/reset-password',
        payload: {
          email: resetEmail,
          code: resetCode,
          newPassword: 'BrandNewPassword456!',
        },
      });

      expect(resetRes.statusCode).toBe(201);

      // 1. Old password must fail login with 401
      const oldLogin = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: resetEmail, password: 'OldPassword123!' },
      });
      expect(oldLogin.statusCode).toBe(401);

      // 2. New password must succeed login with 200/201
      const newLogin = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: resetEmail, password: 'BrandNewPassword456!' },
      });
      expect(newLogin.statusCode).toBe(201);
      expect(JSON.parse(newLogin.payload).success).toBe(true);
    });
  });
});
