/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

import { Test, TestingModule } from '@nestjs/testing';
import {
  NestFastifyApplication,
  FastifyAdapter,
} from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import * as jwt from 'jsonwebtoken';
import { OrdersController } from '@modules/orders/orders.controller';
import { OrdersService } from '@modules/orders/orders.service';
import { InvoicesService } from '@modules/orders/invoices.service';
import { AnalyticsController } from '@modules/analytics/analytics.controller';
import { AnalyticsService } from '@modules/analytics/analytics.service';
import { SettingsController } from '@modules/settings/settings.controller';
import { SettingsService } from '@modules/settings/settings.service';
import { StorageService } from '@modules/storage/storage.service';
import { UsersStore } from '@modules/users/users.store';
import { ConfigService } from '@config/config.service';
import { JwtStrategy } from '../strategies/jwt.strategy';
import { RolesGuard } from './roles.guard';
import { Role } from '@database/schema/enums';
import { User } from '@database/schema';

describe('Administrative API HTTP Endpoint Authorization (TASK-05)', () => {
  let app: NestFastifyApplication;
  const testSecret = 'production-grade-e2e-jwt-secret-key-32chars!';

  const mockUsersStore = {
    findById: jest.fn(),
  };

  const mockOrdersService = {
    getAllOrdersAsAdmin: jest
      .fn()
      .mockResolvedValue([
        { id: 'ord-01', totalAmount: '1200.00', status: 'pending' },
      ]),
    getOrderDetailsAsAdmin: jest.fn().mockResolvedValue({ id: 'ord-01' }),
    updateOrderStatus: jest
      .fn()
      .mockResolvedValue({ id: 'ord-01', status: 'shipped' }),
  };

  const mockInvoicesService = {
    generateInvoicePdf: jest.fn().mockResolvedValue(Buffer.from('PDF')),
  };

  const mockAnalyticsService = {
    getDashboardStats: jest.fn().mockResolvedValue({
      totalRevenue: '50000.00',
      totalOrders: 140,
    }),
  };

  const mockSettingsService = {
    getAllSettings: jest
      .fn()
      .mockResolvedValue([{ key: 'SITE_NAME', value: 'Gramoz' }]),
    setSetting: jest.fn().mockResolvedValue(undefined),
  };

  const mockStorageService = {
    upload: jest.fn().mockResolvedValue('https://storage.gramoz.com/file.jpg'),
  };

  const mockConfigService = {
    jwtSecret: testSecret,
    isProduction: false,
  };

  function createSignedToken(
    payload: {
      sub: string;
      email: string;
      role?: string;
      token_type?: string;
    },
    expiresIn = '1h',
  ): string {
    return jwt.sign(
      {
        token_type: 'access',
        ...payload,
      },
      testSecret,
      {
        expiresIn: expiresIn as any,
      },
    );
  }

  const adminUser: User = {
    id: 'user-admin-1',
    email: 'admin@gramoz.com',
    role: Role.ADMIN,
    status: 'active',
  } as User;

  const superAdminUser: User = {
    id: 'user-super-1',
    email: 'super@gramoz.com',
    role: Role.SUPER_ADMIN,
    status: 'active',
  } as User;

  const supportUser: User = {
    id: 'user-support-1',
    email: 'support@gramoz.com',
    role: Role.SUPPORT,
    status: 'active',
  } as User;

  const customerUser: User = {
    id: 'user-customer-1',
    email: 'customer@gramoz.com',
    role: Role.CUSTOMER,
    status: 'active',
  } as User;

  const suspendedAdminUser: User = {
    id: 'user-suspended-1',
    email: 'suspended@gramoz.com',
    role: Role.ADMIN,
    status: 'suspended',
  } as User;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [OrdersController, AnalyticsController, SettingsController],
      providers: [
        { provide: OrdersService, useValue: mockOrdersService },
        { provide: InvoicesService, useValue: mockInvoicesService },
        { provide: AnalyticsService, useValue: mockAnalyticsService },
        { provide: SettingsService, useValue: mockSettingsService },
        { provide: StorageService, useValue: mockStorageService },
        { provide: UsersStore, useValue: mockUsersStore },
        { provide: ConfigService, useValue: mockConfigService },
        JwtStrategy,
        RolesGuard,
      ],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );

    await app.register(fastifyCookie);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mockUsersStore.findById.mockImplementation((id: string) => {
      if (id === adminUser.id) return Promise.resolve(adminUser);
      if (id === superAdminUser.id) return Promise.resolve(superAdminUser);
      if (id === supportUser.id) return Promise.resolve(supportUser);
      if (id === customerUser.id) return Promise.resolve(customerUser);
      if (id === suspendedAdminUser.id)
        return Promise.resolve(suspendedAdminUser);
      return Promise.resolve(null);
    });
  });

  describe('Unauthenticated Direct API Requests', () => {
    it('returns HTTP 401 when accessing GET /orders/admin/all without credentials', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/orders/admin/all',
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.statusCode).toBe(401);
      expect(body.message).toBe('Unauthorized');
    });

    it('returns HTTP 401 when accessing GET /analytics/dashboard without credentials', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/analytics/dashboard',
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns HTTP 401 when accessing GET /admin/settings without credentials', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/admin/settings',
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('Tampered, Expired, and Inactive Token Direct API Requests', () => {
    it('returns HTTP 401 when token has an expired timestamp', async () => {
      const expiredToken = createSignedToken(
        { sub: adminUser.id, email: adminUser.email, role: Role.ADMIN },
        '-10s',
      );

      const response = await app.inject({
        method: 'GET',
        url: '/orders/admin/all',
        headers: {
          authorization: `Bearer ${expiredToken}`,
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns HTTP 401 when token signature is tampered', async () => {
      const validToken = createSignedToken({
        sub: adminUser.id,
        email: adminUser.email,
        role: Role.ADMIN,
      });
      const tamperedToken = validToken.slice(0, -5) + '99999';

      const response = await app.inject({
        method: 'GET',
        url: '/orders/admin/all',
        headers: {
          authorization: `Bearer ${tamperedToken}`,
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns HTTP 401 when token is signed with an untrusted secret key', async () => {
      const forgedToken = jwt.sign(
        { sub: adminUser.id, email: adminUser.email, role: Role.ADMIN },
        'malicious-attacker-secret-key-32chars!',
        { expiresIn: '1h' },
      );

      const response = await app.inject({
        method: 'GET',
        url: '/orders/admin/all',
        headers: {
          authorization: `Bearer ${forgedToken}`,
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns HTTP 401 when an active admin account has been suspended in PostgreSQL', async () => {
      const token = createSignedToken({
        sub: suspendedAdminUser.id,
        email: suspendedAdminUser.email,
        role: Role.ADMIN,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/orders/admin/all',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.message).toBe('Invalid token or user inactive');
    });
  });

  describe('Customer Role Unauthorized Access Attempts', () => {
    it('returns HTTP 403 when customer attempts GET /orders/admin/all via Bearer header', async () => {
      const token = createSignedToken({
        sub: customerUser.id,
        email: customerUser.email,
        role: Role.CUSTOMER,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/orders/admin/all',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.message).toContain('Access denied');
    });

    it('returns HTTP 403 when customer attempts GET /orders/admin/all via access_token cookie', async () => {
      const token = createSignedToken({
        sub: customerUser.id,
        email: customerUser.email,
        role: Role.CUSTOMER,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/orders/admin/all',
        headers: {
          cookie: `access_token=${token}`,
        },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.message).toContain('Access denied');
    });

    it('returns HTTP 403 when customer attempts GET /analytics/dashboard', async () => {
      const token = createSignedToken({
        sub: customerUser.id,
        email: customerUser.email,
        role: Role.CUSTOMER,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/analytics/dashboard',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(403);
    });

    it('returns HTTP 403 when customer attempts GET /admin/settings', async () => {
      const token = createSignedToken({
        sub: customerUser.id,
        email: customerUser.email,
        role: Role.CUSTOMER,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/admin/settings',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('Role-Specific Hierarchy & Capabilities', () => {
    it('returns HTTP 403 when support role attempts admin-only /admin/settings', async () => {
      // Support role is in PLATFORM_ROLES, but SettingsController requires 'super_admin' or 'admin'
      const token = createSignedToken({
        sub: supportUser.id,
        email: supportUser.email,
        role: Role.SUPPORT,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/admin/settings',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.message).toContain(
        'Requires one of the following roles: super_admin, admin',
      );
    });

    it('returns HTTP 200 when admin role accesses GET /admin/settings', async () => {
      const token = createSignedToken({
        sub: adminUser.id,
        email: adminUser.email,
        role: Role.ADMIN,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/admin/settings',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data).toEqual([{ key: 'SITE_NAME', value: 'Gramoz' }]);
    });
  });

  describe('Authorized Administrative API Requests', () => {
    it('returns HTTP 200 when valid admin accesses GET /orders/admin/all via Bearer header', async () => {
      const token = createSignedToken({
        sub: adminUser.id,
        email: adminUser.email,
        role: Role.ADMIN,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/orders/admin/all',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toEqual([
        { id: 'ord-01', totalAmount: '1200.00', status: 'pending' },
      ]);
    });

    it('returns HTTP 200 when valid admin accesses GET /orders/admin/all via httpOnly cookie', async () => {
      const token = createSignedToken({
        sub: adminUser.id,
        email: adminUser.email,
        role: Role.ADMIN,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/orders/admin/all',
        headers: {
          cookie: `access_token=${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it('returns HTTP 200 when super_admin accesses GET /analytics/dashboard', async () => {
      const token = createSignedToken({
        sub: superAdminUser.id,
        email: superAdminUser.email,
        role: Role.SUPER_ADMIN,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/analytics/dashboard',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.totalOrders).toBe(140);
    });
  });
});
