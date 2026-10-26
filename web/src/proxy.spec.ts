import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from './proxy';
import { createTestJwt } from './lib/auth/jwt-test-helper';

describe('Next.js Edge Proxy Authorization (TASK-05)', () => {
  const testSecret = 'edge-proxy-test-secret-32-characters-long!';

  beforeEach(() => {
    process.env.AUTH_JWT_SECRET = testSecret;
  });

  function makeRequest(pathname: string, cookies: Record<string, string> = {}) {
    const url = new URL(pathname, 'http://localhost:3000');
    const headers = new Headers();
    const cookieHeader = Object.entries(cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
    if (cookieHeader) {
      headers.set('cookie', cookieHeader);
    }
    return new NextRequest(url, { headers });
  }

  describe('Unauthenticated Guest Access', () => {
    it('redirects guest accessing /admin to /login with redirect parameter', async () => {
      const req = makeRequest('/admin');
      const res = await proxy(req);

      expect(res.status).toBe(307);
      const location = res.headers.get('location');
      expect(location).toBe('http://localhost:3000/login?redirect=%2Fadmin');
    });

    it('redirects guest accessing nested /admin/products/new to /login', async () => {
      const req = makeRequest('/admin/products/new');
      const res = await proxy(req);

      expect(res.status).toBe(307);
      const location = res.headers.get('location');
      expect(location).toBe('http://localhost:3000/login?redirect=%2Fadmin%2Fproducts%2Fnew');
    });

    it('redirects guest accessing /dashboard to /login', async () => {
      const req = makeRequest('/dashboard/orders');
      const res = await proxy(req);

      expect(res.status).toBe(307);
      const location = res.headers.get('location');
      expect(location).toBe('http://localhost:3000/login?redirect=%2Fdashboard%2Forders');
    });

    it('allows guest to access /login and /register', async () => {
      const loginReq = makeRequest('/login');
      const loginRes = await proxy(loginReq);
      expect(loginRes.status).toBe(200);

      const regReq = makeRequest('/register');
      const regRes = await proxy(regReq);
      expect(regRes.status).toBe(200);
    });
  });

  describe('Customer Role Access Restrictions', () => {
    it('blocks authenticated customer from accessing /admin and redirects to home', async () => {
      const customerToken = await createTestJwt(
        { sub: 'cust-101', email: 'customer@gramoz.com', role: 'customer' },
        testSecret,
        { expiresInSeconds: 900 },
      );

      const req = makeRequest('/admin', { access_token: customerToken });
      const res = await proxy(req);

      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toBe('http://localhost:3000/');
    });

    it('blocks authenticated customer from nested admin routes (/admin/orders)', async () => {
      const customerToken = await createTestJwt(
        { sub: 'cust-101', email: 'customer@gramoz.com', role: 'customer' },
        testSecret,
        { expiresInSeconds: 900 },
      );

      const req = makeRequest('/admin/orders', { access_token: customerToken });
      const res = await proxy(req);

      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toBe('http://localhost:3000/');
    });

    it('allows authenticated customer to access /dashboard routes', async () => {
      const customerToken = await createTestJwt(
        { sub: 'cust-101', email: 'customer@gramoz.com', role: 'customer' },
        testSecret,
        { expiresInSeconds: 900 },
      );

      const req = makeRequest('/dashboard/profile', { access_token: customerToken });
      const res = await proxy(req);

      expect(res.status).toBe(200);
      expect(res.headers.get('x-user-id')).toBe('cust-101');
      expect(res.headers.get('x-user-role')).toBe('customer');
    });

    it('redirects authenticated customer away from /login to /dashboard', async () => {
      const customerToken = await createTestJwt(
        { sub: 'cust-101', email: 'customer@gramoz.com', role: 'customer' },
        testSecret,
        { expiresInSeconds: 900 },
      );

      const req = makeRequest('/login', { access_token: customerToken });
      const res = await proxy(req);

      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toBe('http://localhost:3000/dashboard');
    });
  });

  describe('Platform Administrator Access', () => {
    it('allows admin role to access /admin', async () => {
      const adminToken = await createTestJwt(
        { sub: 'adm-001', email: 'admin@gramoz.com', role: 'admin' },
        testSecret,
        { expiresInSeconds: 900 },
      );

      const req = makeRequest('/admin', { access_token: adminToken });
      const res = await proxy(req);

      expect(res.status).toBe(200);
      expect(res.headers.get('x-user-id')).toBe('adm-001');
      expect(res.headers.get('x-user-role')).toBe('admin');
    });

    it('allows super_admin role to access nested admin routes', async () => {
      const superAdminToken = await createTestJwt(
        { sub: 'sup-001', email: 'super@gramoz.com', role: 'super_admin' },
        testSecret,
        { expiresInSeconds: 900 },
      );

      const req = makeRequest('/admin/system', { access_token: superAdminToken });
      const res = await proxy(req);

      expect(res.status).toBe(200);
      expect(res.headers.get('x-user-id')).toBe('sup-001');
      expect(res.headers.get('x-user-role')).toBe('super_admin');
    });

    it('allows support role to access /admin', async () => {
      const supportToken = await createTestJwt(
        { sub: 'sup-002', email: 'support@gramoz.com', role: 'support' },
        testSecret,
        { expiresInSeconds: 900 },
      );

      const req = makeRequest('/admin/reviews', { access_token: supportToken });
      const res = await proxy(req);

      expect(res.status).toBe(200);
      expect(res.headers.get('x-user-id')).toBe('sup-002');
      expect(res.headers.get('x-user-role')).toBe('support');
    });

    it('redirects authenticated admin away from /login to /admin', async () => {
      const adminToken = await createTestJwt(
        { sub: 'adm-001', email: 'admin@gramoz.com', role: 'admin' },
        testSecret,
        { expiresInSeconds: 900 },
      );

      const req = makeRequest('/login', { access_token: adminToken });
      const res = await proxy(req);

      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toBe('http://localhost:3000/admin');
    });
  });

  describe('Token Security & Invalidation Handling', () => {
    it('rejects expired token and clears access_token cookie', async () => {
      const expiredToken = await createTestJwt(
        { sub: 'adm-001', email: 'admin@gramoz.com', role: 'admin' },
        testSecret,
        { expiresInSeconds: -300 }, // Expired 5 mins ago
      );

      const req = makeRequest('/admin', { access_token: expiredToken });
      const res = await proxy(req);

      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toBe('http://localhost:3000/login?redirect=%2Fadmin');

      // Verify stale cookie was purged in response
      const setCookie = res.headers.get('set-cookie');
      expect(setCookie).toContain('access_token=;');
    });

    it('rejects tampered token signature and clears cookie', async () => {
      const validToken = await createTestJwt(
        { sub: 'adm-001', email: 'admin@gramoz.com', role: 'admin' },
        testSecret,
        { expiresInSeconds: 900 },
      );

      const parts = validToken.split('.');
      const tamperedToken = `${parts[0]}.${parts[1]}.TAMPERED_SIG`;

      const req = makeRequest('/admin', { access_token: tamperedToken });
      const res = await proxy(req);

      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toBe('http://localhost:3000/login?redirect=%2Fadmin');
      const setCookie = res.headers.get('set-cookie');
      expect(setCookie).toContain('access_token=;');
    });

    it('rejects token signed with wrong secret', async () => {
      const forgedToken = await createTestJwt(
        { sub: 'adm-001', email: 'admin@gramoz.com', role: 'admin' },
        'attacker-forged-secret-key-32-chars!',
        { expiresInSeconds: 900 },
      );

      const req = makeRequest('/admin', { access_token: forgedToken });
      const res = await proxy(req);

      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toBe('http://localhost:3000/login?redirect=%2Fadmin');
    });

    it('rejects refresh token presented in access_token cookie and clears cookie', async () => {
      const refreshToken = await createTestJwt(
        { sub: 'adm-001', email: 'admin@gramoz.com', role: 'admin', token_type: 'refresh' },
        testSecret,
        { expiresInSeconds: 604800 },
      );

      const req = makeRequest('/admin', { access_token: refreshToken });
      const res = await proxy(req);

      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toBe('http://localhost:3000/login?redirect=%2Fadmin');
      const setCookie = res.headers.get('set-cookie');
      expect(setCookie).toContain('access_token=;');
    });

    it('rejects legacy pre-TASK-16F token lacking token_type in access_token cookie and clears cookie', async () => {
      // Create a token explicitly without token_type
      const legacyToken = await createTestJwt(
        { sub: 'adm-001', email: 'admin@gramoz.com', role: 'admin', token_type: undefined },
        testSecret,
        { expiresInSeconds: 604800 },
      );

      const req = makeRequest('/admin', { access_token: legacyToken });
      const res = await proxy(req);

      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toBe('http://localhost:3000/login?redirect=%2Fadmin');
      const setCookie = res.headers.get('set-cookie');
      expect(setCookie).toContain('access_token=;');
    });

    it('rejects token with unknown token_type in access_token cookie', async () => {
      const unknownToken = await createTestJwt(
        { sub: 'adm-001', email: 'admin@gramoz.com', role: 'admin', token_type: 'id_token' },
        testSecret,
        { expiresInSeconds: 900 },
      );

      const req = makeRequest('/admin', { access_token: unknownToken });
      const res = await proxy(req);

      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toBe('http://localhost:3000/login?redirect=%2Fadmin');
    });
  });
});
