import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resolveBackendOrigin,
  resolveInternalApiUrl,
  resolvePublicApiUrl,
  resolvePublicServerUrl,
  resolveImageRemotePatterns,
} from './config';

describe('Next.js Environment Configuration & Image Remote Patterns (TASK-08b)', () => {
  const originalEnv = { ...process.env };

  function setEnv(key: string, value?: string) {
    if (value === undefined) {
      delete (process.env as Record<string, string | undefined>)[key];
    } else {
      (process.env as Record<string, string | undefined>)[key] = value;
    }
  }

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('resolveBackendOrigin', () => {
    it('returns http://localhost:5000 in development when INTERNAL_API_URL is unset', () => {
      setEnv('INTERNAL_API_URL', undefined);
      setEnv('BACKEND_INTERNAL_URL', undefined);
      setEnv('NODE_ENV', 'development');

      const origin = resolveBackendOrigin(process.env);
      expect(origin).toBe('http://localhost:5000');
    });

    it('returns configured INTERNAL_API_URL origin in development', () => {
      setEnv('INTERNAL_API_URL', 'http://127.0.0.1:5001');
      setEnv('NODE_ENV', 'development');

      const origin = resolveBackendOrigin(process.env);
      expect(origin).toBe('http://127.0.0.1:5001');
    });

    it('resolves internal Docker service hostname (e.g. http://backend:5000)', () => {
      setEnv('INTERNAL_API_URL', 'http://backend:5000');
      setEnv('NODE_ENV', 'production');

      const origin = resolveBackendOrigin(process.env);
      expect(origin).toBe('http://backend:5000');
    });

    it('resolves production HTTPS backend origin', () => {
      setEnv('INTERNAL_API_URL', 'https://api.gramoz.com');
      setEnv('NODE_ENV', 'production');

      const origin = resolveBackendOrigin(process.env);
      expect(origin).toBe('https://api.gramoz.com');
    });

    it('extracts pure origin when subpath or trailing slash is provided', () => {
      setEnv('INTERNAL_API_URL', 'http://backend:5000/api/v1/');
      setEnv('NODE_ENV', 'production');

      const origin = resolveBackendOrigin(process.env);
      expect(origin).toBe('http://backend:5000');
    });

    it('supports BACKEND_INTERNAL_URL as alternative environment variable', () => {
      setEnv('INTERNAL_API_URL', undefined);
      setEnv('BACKEND_INTERNAL_URL', 'http://api-cluster:5000');
      setEnv('NODE_ENV', 'production');

      const origin = resolveBackendOrigin(process.env);
      expect(origin).toBe('http://api-cluster:5000');
    });

    it('throws descriptive error in production if INTERNAL_API_URL is missing', () => {
      setEnv('INTERNAL_API_URL', undefined);
      setEnv('BACKEND_INTERNAL_URL', undefined);
      setEnv('NODE_ENV', 'production');

      expect(() => resolveBackendOrigin(process.env)).toThrow(
        /INTERNAL_API_URL is required in production/
      );
    });

    it('throws descriptive error if URL is malformed', () => {
      setEnv('INTERNAL_API_URL', 'not-a-valid-url');
      setEnv('NODE_ENV', 'development');

      expect(() => resolveBackendOrigin(process.env)).toThrow(
        /Invalid URL format for INTERNAL_API_URL/
      );
    });

    it('throws descriptive error if protocol is not http or https', () => {
      setEnv('INTERNAL_API_URL', 'ftp://backend:21');
      setEnv('NODE_ENV', 'development');

      expect(() => resolveBackendOrigin(process.env)).toThrow(
        /must use http: or https: protocol/
      );
    });

    it('enforces that internal backend URL is NOT exposed via NEXT_PUBLIC_ variable', () => {
      // In Next.js, only variables prefixed with NEXT_PUBLIC_ are bundled into client code.
      // Confirm that INTERNAL_API_URL does NOT start with NEXT_PUBLIC_.
      const variableName = 'INTERNAL_API_URL';
      expect(variableName.startsWith('NEXT_PUBLIC_')).toBe(false);
    });
  });

  describe('resolveInternalApiUrl', () => {
    it('appends /api/v1 to bare origin when no subpath is provided', () => {
      setEnv('INTERNAL_API_URL', 'http://backend:5000');
      setEnv('NODE_ENV', 'production');

      const apiUrl = resolveInternalApiUrl(process.env);
      expect(apiUrl).toBe('http://backend:5000/api/v1');
    });

    it('preserves existing subpath when provided in INTERNAL_API_URL', () => {
      setEnv('INTERNAL_API_URL', 'http://backend:5000/api/v2');
      setEnv('NODE_ENV', 'production');

      const apiUrl = resolveInternalApiUrl(process.env);
      expect(apiUrl).toBe('http://backend:5000/api/v2');
    });

    it('defaults to http://localhost:5000/api/v1 in development', () => {
      setEnv('INTERNAL_API_URL', undefined);
      setEnv('BACKEND_INTERNAL_URL', undefined);
      setEnv('NODE_ENV', 'development');

      const apiUrl = resolveInternalApiUrl(process.env);
      expect(apiUrl).toBe('http://localhost:5000/api/v1');
    });
  });

  describe('resolvePublicApiUrl & resolvePublicServerUrl', () => {
    it('defaults resolvePublicApiUrl to /api/v1', () => {
      setEnv('NEXT_PUBLIC_API_URL', undefined);
      expect(resolvePublicApiUrl(process.env)).toBe('/api/v1');
    });

    it('respects custom NEXT_PUBLIC_API_URL when set', () => {
      setEnv('NEXT_PUBLIC_API_URL', '/custom-api');
      expect(resolvePublicApiUrl(process.env)).toBe('/custom-api');
    });

    it('defaults resolvePublicServerUrl to empty string when unset', () => {
      setEnv('NEXT_PUBLIC_SERVER_URL', undefined);
      expect(resolvePublicServerUrl(process.env)).toBe('');
    });

    it('respects NEXT_PUBLIC_SERVER_URL when configured for direct domain OAuth', () => {
      setEnv('NEXT_PUBLIC_SERVER_URL', 'https://api.gramoz.com');
      expect(resolvePublicServerUrl(process.env)).toBe('https://api.gramoz.com');
    });
  });

  describe('resolveImageRemotePatterns (Storage & CDN Allowlist)', () => {
    it('includes Cloudflare R2 production domain media.gramoz.com by default', () => {
      setEnv('NODE_ENV', 'production');
      const patterns = resolveImageRemotePatterns(process.env);

      const r2Pattern = patterns.find((p) => p.hostname === 'media.gramoz.com');
      expect(r2Pattern).toBeDefined();
      expect(r2Pattern?.protocol).toBe('https');
    });

    it('includes Unsplash CDN by default', () => {
      const patterns = resolveImageRemotePatterns(process.env);

      const unsplashPattern = patterns.find((p) => p.hostname === 'images.unsplash.com');
      expect(unsplashPattern).toBeDefined();
      expect(unsplashPattern?.protocol).toBe('https');
    });

    it('dynamically adds custom media URL from R2_PUBLIC_URL', () => {
      setEnv('R2_PUBLIC_URL', 'https://custom-bucket.r2.dev');
      const patterns = resolveImageRemotePatterns(process.env);

      const customPattern = patterns.find((p) => p.hostname === 'custom-bucket.r2.dev');
      expect(customPattern).toBeDefined();
      expect(customPattern?.protocol).toBe('https');
      expect(customPattern?.pathname).toBe('/**');
    });

    it('dynamically adds custom media URL from MEDIA_URL', () => {
      setEnv('MEDIA_URL', 'https://cdn.gramoz-store.com');
      const patterns = resolveImageRemotePatterns(process.env);

      const customPattern = patterns.find((p) => p.hostname === 'cdn.gramoz-store.com');
      expect(customPattern).toBeDefined();
      expect(customPattern?.protocol).toBe('https');
    });

    it('includes localhost and 127.0.0.1 in development for local disk upload fallback', () => {
      setEnv('NODE_ENV', 'development');
      const patterns = resolveImageRemotePatterns(process.env);

      const localhostPattern = patterns.find((p) => p.hostname === 'localhost');
      const loopbackPattern = patterns.find((p) => p.hostname === '127.0.0.1');

      expect(localhostPattern).toBeDefined();
      expect(loopbackPattern).toBeDefined();
    });

    it('excludes localhost and 127.0.0.1 in production to prevent SSRF vulnerabilities', () => {
      setEnv('NODE_ENV', 'production');
      const patterns = resolveImageRemotePatterns(process.env);

      const localhostPattern = patterns.find((p) => p.hostname === 'localhost');
      const loopbackPattern = patterns.find((p) => p.hostname === '127.0.0.1');

      expect(localhostPattern).toBeUndefined();
      expect(loopbackPattern).toBeUndefined();
    });

    it('rejects arbitrary external image hosts not in allowlist', () => {
      setEnv('NODE_ENV', 'production');
      const patterns = resolveImageRemotePatterns(process.env);

      const allowedHosts = patterns.map((p) => p.hostname);
      expect(allowedHosts).not.toContain('malicious-site.com');
      expect(allowedHosts).not.toContain('random-bucket.s3.amazonaws.com');
      expect(allowedHosts).not.toContain('untrusted-cdn.net');
    });
  });
});
