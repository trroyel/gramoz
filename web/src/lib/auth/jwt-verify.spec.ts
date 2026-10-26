import { describe, it, expect, beforeEach } from 'vitest';
import { verifyJwtToken } from './jwt-verify';
import { createTestJwt } from './jwt-test-helper';

describe('verifyJwtToken (Web Crypto Security Unit Tests)', () => {
  const testSecret = 'super-secure-production-ready-secret-key-32chars!';

  beforeEach(() => {
    process.env.AUTH_JWT_SECRET = testSecret;
  });

  it('successfully verifies a valid active token with correct signature', async () => {
    const token = await createTestJwt(
      { sub: 'usr-001', email: 'admin@gramoz.com', role: 'admin' },
      testSecret,
      { expiresInSeconds: 900 },
    );

    const payload = await verifyJwtToken(token, testSecret);
    expect(payload).not.toBeNull();
    expect(payload?.sub).toBe('usr-001');
    expect(payload?.email).toBe('admin@gramoz.com');
    expect(payload?.role).toBe('admin');
  });

  it('rejects an expired token', async () => {
    const token = await createTestJwt(
      { sub: 'usr-002', email: 'user@gramoz.com', role: 'customer' },
      testSecret,
      { expiresInSeconds: -60 }, // Expired 1 minute ago
    );

    const payload = await verifyJwtToken(token, testSecret);
    expect(payload).toBeNull();
  });

  it('rejects a token signed with an invalid/different secret', async () => {
    const wrongSecret = 'another-unrelated-secret-key-that-does-not-match!';
    const token = await createTestJwt(
      { sub: 'usr-003', email: 'hacker@gramoz.com', role: 'admin' },
      wrongSecret,
      { expiresInSeconds: 900 },
    );

    const payload = await verifyJwtToken(token, testSecret);
    expect(payload).toBeNull();
  });

  it('rejects a token whose payload was tampered with', async () => {
    const token = await createTestJwt(
      { sub: 'usr-004', email: 'customer@gramoz.com', role: 'customer' },
      testSecret,
      { expiresInSeconds: 900 },
    );

    const parts = token.split('.');
    // Tamper the payload: change customer to admin
    const tamperedPayloadB64 = Buffer.from(
      JSON.stringify({ sub: 'usr-004', email: 'customer@gramoz.com', role: 'admin' }),
    ).toString('base64url');
    const tamperedToken = `${parts[0]}.${tamperedPayloadB64}.${parts[2]}`;

    const payload = await verifyJwtToken(tamperedToken, testSecret);
    expect(payload).toBeNull();
  });

  it('rejects a token whose signature was tampered with', async () => {
    const token = await createTestJwt(
      { sub: 'usr-005', email: 'admin@gramoz.com', role: 'admin' },
      testSecret,
      { expiresInSeconds: 900 },
    );

    const parts = token.split('.');
    const corruptedSig = parts[2].slice(0, -4) + 'XXXX';
    const tamperedToken = `${parts[0]}.${parts[1]}.${corruptedSig}`;

    const payload = await verifyJwtToken(tamperedToken, testSecret);
    expect(payload).toBeNull();
  });

  it('rejects tokens with non-HS256 algorithms (e.g. alg: none attack)', async () => {
    const token = await createTestJwt(
      { sub: 'usr-006', email: 'admin@gramoz.com', role: 'admin' },
      testSecret,
      { expiresInSeconds: 900, alg: 'none' },
    );

    const payload = await verifyJwtToken(token, testSecret);
    expect(payload).toBeNull();
  });

  it('rejects malformed token strings', async () => {
    expect(await verifyJwtToken('', testSecret)).toBeNull();
    expect(await verifyJwtToken('not.a.valid.jwt.string', testSecret)).toBeNull();
    expect(await verifyJwtToken('header.payload', testSecret)).toBeNull();
    expect(await verifyJwtToken('header.payload.sig.extra', testSecret)).toBeNull();
    expect(await verifyJwtToken('null', testSecret)).toBeNull();
  });

  it('resolves secret from process.env.AUTH_JWT_SECRET when omitted', async () => {
    const token = await createTestJwt(
      { sub: 'usr-007', email: 'admin@gramoz.com', role: 'admin' },
      testSecret,
      { expiresInSeconds: 900 },
    );

    const payload = await verifyJwtToken(token); // Omit secret parameter
    expect(payload).not.toBeNull();
    expect(payload?.sub).toBe('usr-007');
  });

  it('returns null if no secret is configured anywhere', async () => {
    delete process.env.AUTH_JWT_SECRET;
    delete process.env.JWT_SECRET;

    const token = await createTestJwt(
      { sub: 'usr-008', email: 'admin@gramoz.com', role: 'admin' },
      testSecret,
      { expiresInSeconds: 900 },
    );

    const payload = await verifyJwtToken(token);
    expect(payload).toBeNull();
  });
});
