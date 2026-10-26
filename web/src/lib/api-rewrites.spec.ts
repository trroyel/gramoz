import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import nextConfig from '../../next.config';
import { NextRequest } from 'next/server';
import { proxy } from '../proxy';
import { createTestJwt } from './auth/jwt-test-helper';

describe('Next.js API Rewrites & Proxy Route Security (TASK-08b)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('next.config.ts rewrites()', () => {
    it('returns an array of rewrite rules', async () => {
      process.env.INTERNAL_API_URL = 'http://backend:5000';
      if (!nextConfig.rewrites) {
        throw new Error('nextConfig.rewrites is not defined');
      }

      const rewrites = await nextConfig.rewrites();
      expect(Array.isArray(rewrites)).toBe(true);
      if (!Array.isArray(rewrites)) throw new Error('Expected rewrites to be an array');
      expect(rewrites.length).toBeGreaterThanOrEqual(2);
    });

    it('maps /api/:path* to configured internal backend destination', async () => {
      process.env.INTERNAL_API_URL = 'http://backend:5000';
      if (!nextConfig.rewrites) throw new Error('nextConfig.rewrites missing');

      const rewrites = await nextConfig.rewrites();
      const apiRewrite = (rewrites as Array<{ source: string; destination: string }>).find(
        (r) => r.source === '/api/:path*'
      );

      expect(apiRewrite).toBeDefined();
      expect(apiRewrite?.destination).toBe('http://backend:5000/api/:path*');
    });

    it('maps /public/:path* to configured backend for local disk uploads', async () => {
      process.env.INTERNAL_API_URL = 'http://backend:5000';
      if (!nextConfig.rewrites) throw new Error('nextConfig.rewrites missing');

      const rewrites = await nextConfig.rewrites();
      const publicRewrite = (rewrites as Array<{ source: string; destination: string }>).find(
        (r) => r.source === '/public/:path*'
      );

      expect(publicRewrite).toBeDefined();
      expect(publicRewrite?.destination).toBe('http://backend:5000/public/:path*');
    });

    it('preserves nested routes and query parameters via :path* wildcard substitution', async () => {
      // In Next.js rewrites, :path* matches all subsegments and query parameters are appended automatically
      process.env.INTERNAL_API_URL = 'https://api.gramoz.com';
      if (!nextConfig.rewrites) throw new Error('nextConfig.rewrites missing');

      const rewrites = await nextConfig.rewrites();
      const apiRewrite = (rewrites as Array<{ source: string; destination: string }>).find(
        (r) => r.source === '/api/:path*'
      );

      expect(apiRewrite?.destination).toContain(':path*');
    });
  });

  describe('Proxy Identity Header Sanitization (CWE-284 Defense)', () => {
    const testSecret = 'edge-proxy-test-secret-32-characters-long!';

    function createRequestWithHeaders(
      pathname: string,
      headers: Record<string, string>,
      cookieToken?: string
    ) {
      const url = new URL(pathname, 'http://localhost:3000');
      const reqHeaders = new Headers(headers);
      if (cookieToken) {
        reqHeaders.set('cookie', `access_token=${cookieToken}`);
      }
      return new NextRequest(url, { headers: reqHeaders });
    }

    it('strips client-supplied x-user-id and x-user-role headers from guest requests', async () => {
      process.env.AUTH_JWT_SECRET = testSecret;

      const req = createRequestWithHeaders(
        '/login',
        {
          'x-user-id': 'spoofed-admin-uuid',
          'x-user-role': 'super_admin',
        }
      );

      const res = await proxy(req);

      // Verify response headers do not propagate spoofed claims
      expect(res.headers.get('x-user-id')).toBeNull();
      expect(res.headers.get('x-user-role')).toBeNull();
    });

    it('overwrites client-supplied headers with cryptographically verified token claims', async () => {
      process.env.AUTH_JWT_SECRET = testSecret;
      const legitToken = await createTestJwt(
        { sub: 'legit-admin-123', email: 'admin@gramoz.com', role: 'admin' },
        testSecret
      );

      const req = createRequestWithHeaders(
        '/admin/orders',
        {
          'x-user-id': 'attacker-spoofed-id',
          'x-user-role': 'super_admin',
        },
        legitToken
      );

      const res = await proxy(req);

      expect(res.status).toBe(200);
      expect(res.headers.get('x-user-id')).toBe('legit-admin-123');
      expect(res.headers.get('x-user-role')).toBe('admin');
    });
  });
});
