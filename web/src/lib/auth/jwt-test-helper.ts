/**
 * Deterministic JWT signing helper for automated security tests.
 * Uses Web Crypto API.
 */

function stringToBase64Url(str: string): string {
  const base64 = Buffer.from(str, 'utf8').toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function bytesToBase64Url(bytes: Uint8Array): string {
  const base64 = Buffer.from(bytes).toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function createTestJwt(
  payload: Record<string, unknown>,
  secret: string,
  options?: { expiresInSeconds?: number; alg?: string },
): Promise<string> {
  const alg = options?.alg ?? 'HS256';
  const header = { alg, typ: 'JWT' };

  const nowSeconds = Math.floor(Date.now() / 1000);
  const fullPayload = {
    token_type: 'access',
    iat: nowSeconds,
    ...(options?.expiresInSeconds !== undefined
      ? { exp: nowSeconds + options.expiresInSeconds }
      : {}),
    ...payload,
  };

  const headerB64 = stringToBase64Url(JSON.stringify(header));
  const payloadB64 = stringToBase64Url(JSON.stringify(fullPayload));
  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);

  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const sigBuffer = await globalThis.crypto.subtle.sign('HMAC', key, data);
  const sigB64 = bytesToBase64Url(new Uint8Array(sigBuffer));

  return `${headerB64}.${payloadB64}.${sigB64}`;
}
