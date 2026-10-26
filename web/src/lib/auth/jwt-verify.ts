/**
 * Cryptographic JWT verification for Next.js Edge/Server Proxy.
 * Uses native Web Crypto API (crypto.subtle) without external dependencies.
 */

export interface VerifiedTokenPayload {
  sub: string;
  email: string;
  role?: string;
  token_type?: string;
  exp?: number;
  iat?: number;
  [key: string]: unknown;
}

function base64UrlToUint8Array(base64Url: string): Uint8Array {
  let base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (base64.length % 4)) % 4;
  base64 += '='.repeat(padLength);

  if (typeof atob === 'function') {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  // Node.js fallback
  return new Uint8Array(Buffer.from(base64, 'base64'));
}

function base64UrlDecodeToString(base64Url: string): string {
  let base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (base64.length % 4)) % 4;
  base64 += '='.repeat(padLength);

  if (typeof atob === 'function') {
    return atob(base64);
  }

  return Buffer.from(base64, 'base64').toString('utf8');
}

/**
 * Cryptographically verifies an HMAC-SHA256 (HS256) signed JWT.
 * Validates format, algorithm header, expiration timestamp, and HMAC signature.
 *
 * @param token Raw JWT string from httpOnly cookie or Authorization header
 * @param secret Optional secret override (defaults to AUTH_JWT_SECRET or JWT_SECRET)
 * @returns VerifiedTokenPayload on success, or null on verification failure
 */
export async function verifyJwtToken(
  token: string,
  secret?: string,
): Promise<VerifiedTokenPayload | null> {
  if (!token || typeof token !== 'string') return null;

  const resolvedSecret =
    secret || process.env.AUTH_JWT_SECRET || process.env.JWT_SECRET;
  if (!resolvedSecret) {
    return null;
  }

  const parts = token.trim().split('.');
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, signatureB64] = parts;
  if (!headerB64 || !payloadB64 || !signatureB64) return null;

  try {
    // 1. Decode and validate header
    const headerJson = base64UrlDecodeToString(headerB64);
    const header = JSON.parse(headerJson);
    if (!header || header.alg !== 'HS256') {
      return null;
    }

    // 2. Decode and validate payload
    const payloadJson = base64UrlDecodeToString(payloadB64);
    const payload = JSON.parse(payloadJson) as VerifiedTokenPayload;
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    // 2.1 Verify token_type is strictly 'access'
    if (payload.token_type !== 'access') {
      return null;
    }

    // 3. Verify expiration
    if (typeof payload.exp === 'number') {
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (payload.exp <= nowSeconds) {
        return null; // Expired
      }
    }

    // 4. Verify cryptographic signature via Web Crypto API
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) {
      return null;
    }

    const enc = new TextEncoder();
    const key = await subtle.importKey(
      'raw',
      enc.encode(resolvedSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );

    const signedData = enc.encode(`${headerB64}.${payloadB64}`);
    const signatureBytes = base64UrlToUint8Array(signatureB64);

    const isValid = await subtle.verify(
      'HMAC',
      key,
      signatureBytes as unknown as BufferSource,
      signedData,
    );

    if (!isValid) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}
