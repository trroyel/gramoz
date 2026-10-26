import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import nextConfig from '../../next.config';
import { resolveBackendOrigin, resolveInternalApiUrl } from './config';

describe('Next.js API Rewrite Integration & Real HTTP Dispatch (TASK-08b)', () => {
  let backendServer: http.Server;
  let backendPort: number;
  let backendOrigin: string;

  // Requests logged by the simulated NestJS backend for assertion
  const receivedRequests: Array<{
    method: string;
    url: string;
    headers: http.IncomingHttpHeaders;
    body: string;
  }> = [];

  beforeAll(async () => {
    // 1. Spin up an actual Node.js HTTP server simulating the NestJS Fastify backend
    backendServer = http.createServer(async (req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });

      req.on('end', () => {
        receivedRequests.push({
          method: req.method || 'GET',
          url: req.url || '/',
          headers: req.headers,
          body,
        });

        // Mock routes
        if (req.url?.startsWith('/api/v1/products')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, data: [{ id: 'p1', name: 'Cotton Shirt' }] }));
          return;
        }

        if (req.url === '/api/v1/auth/login' && req.method === 'POST') {
          const parsed = JSON.parse(body || '{}');
          if (parsed.email === 'admin@gramoz.com' && parsed.password === 'pass123') {
            res.writeHead(200, {
              'Content-Type': 'application/json',
              'Set-Cookie': 'access_token=valid-jwt-token-abc; Path=/; HttpOnly; SameSite=Lax',
            });
            res.end(JSON.stringify({ success: true, user: { id: 'u1', email: parsed.email } }));
            return;
          }
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: 'Invalid credentials' }));
          return;
        }

        if (req.url === '/api/v1/orders/my-orders') {
          const cookie = req.headers['cookie'] || '';
          if (cookie.includes('access_token=valid-jwt-token-abc')) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, orders: [{ id: 'ord-123' }] }));
            return;
          }
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
          return;
        }

        if (req.url?.startsWith('/public/uploads/')) {
          res.writeHead(200, { 'Content-Type': 'image/png' });
          res.end(Buffer.from('fake-png-binary-stream'));
          return;
        }

        if (req.url === '/api/v1/server-error') {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: 'Internal server error' }));
          return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: 'Not found' }));
      });
    });

    await new Promise<void>((resolve) => {
      backendServer.listen(0, '127.0.0.1', () => {
        const addr = backendServer.address() as AddressInfo;
        backendPort = addr.port;
        backendOrigin = `http://127.0.0.1:${backendPort}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      backendServer.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it('correctly maps rewrite configuration to the live backend origin', async () => {
    process.env.INTERNAL_API_URL = backendOrigin;
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';

    const origin = resolveBackendOrigin(process.env);
    expect(origin).toBe(backendOrigin);

    const apiUrl = resolveInternalApiUrl(process.env);
    expect(apiUrl).toBe(`${backendOrigin}/api/v1`);

    if (!nextConfig.rewrites) throw new Error('Rewrites not configured');
    const rewrites = await nextConfig.rewrites();
    const rules = rewrites as Array<{ source: string; destination: string }>;

    expect(rules.find((r) => r.source === '/api/:path*')?.destination).toBe(
      `${backendOrigin}/api/:path*`
    );
    expect(rules.find((r) => r.source === '/public/:path*')?.destination).toBe(
      `${backendOrigin}/public/:path*`
    );
  });

  it('dispatches GET request preserving query parameters to the live backend', async () => {
    const targetUrl = `${backendOrigin}/api/v1/products?category=apparel&limit=10&page=2`;
    const res = await fetch(targetUrl, { method: 'GET' });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data[0].name).toBe('Cotton Shirt');

    const lastReq = receivedRequests[receivedRequests.length - 1];
    expect(lastReq.method).toBe('GET');
    expect(lastReq.url).toBe('/api/v1/products?category=apparel&limit=10&page=2');
  });

  it('dispatches POST request preserving JSON body and headers', async () => {
    const targetUrl = `${backendOrigin}/api/v1/auth/login`;
    const payload = { email: 'admin@gramoz.com', password: 'pass123' };

    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Custom-Client-Header': 'Gramoz-Web-1.0',
      },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toContain('access_token=valid-jwt-token-abc');

    const lastReq = receivedRequests[receivedRequests.length - 1];
    expect(lastReq.method).toBe('POST');
    expect(lastReq.url).toBe('/api/v1/auth/login');
    expect(JSON.parse(lastReq.body)).toEqual(payload);
    expect(lastReq.headers['x-custom-client-header']).toBe('Gramoz-Web-1.0');
  });

  it('forwards authentication cookies to protected backend endpoints', async () => {
    const targetUrl = `${backendOrigin}/api/v1/orders/my-orders`;
    const res = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        Cookie: 'access_token=valid-jwt-token-abc',
      },
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.orders).toHaveLength(1);

    const lastReq = receivedRequests[receivedRequests.length - 1];
    expect(lastReq.headers['cookie']).toBe('access_token=valid-jwt-token-abc');
  });

  it('correctly handles backend 401 Unauthorized when credentials are missing or invalid', async () => {
    const targetUrl = `${backendOrigin}/api/v1/orders/my-orders`;
    const res = await fetch(targetUrl, {
      method: 'GET',
      // No cookie
    });

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.message).toBe('Unauthorized');
  });

  it('proxies static assets via /public rewrite path without corruption', async () => {
    const targetUrl = `${backendOrigin}/public/uploads/sample.png`;
    const res = await fetch(targetUrl, { method: 'GET' });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    const buffer = await res.arrayBuffer();
    expect(Buffer.from(buffer).toString()).toBe('fake-png-binary-stream');
  });

  it('propagates backend 500 errors transparently without crashing client', async () => {
    const targetUrl = `${backendOrigin}/api/v1/server-error`;
    const res = await fetch(targetUrl, { method: 'GET' });

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.message).toBe('Internal server error');
  });
});
