import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { authApi } from './auth';

describe('Frontend Authentication API Rate Limit & 429 Handling (TASK-07)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('correctly handles HTTP 429 on login and extracts user-friendly retry message', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: new Headers({
        'retry-after': '45',
        'content-type': 'application/json',
      }),
      text: async () =>
        JSON.stringify({
          success: false,
          error: {
            message: 'Too many requests. Please try again in 45 seconds.',
          },
        }),
    } as unknown as Response);

    await expect(
      authApi.login({ email: 'test@gramoz.com', password: 'password123' }),
    ).rejects.toThrow('Too many requests. Please try again in 45 seconds.');
  });

  it('surfaces non-enumerating HTTP 429 message on forgot-password', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: new Headers({
        'retry-after': '300',
        'content-type': 'application/json',
      }),
      text: async () =>
        JSON.stringify({
          success: false,
          error: {
            message: 'Too many requests. Please try again in 300 seconds.',
          },
        }),
    } as unknown as Response);

    await expect(
      authApi.forgotPassword({ email: 'victim@gramoz.com' }),
    ).rejects.toThrow('Too many requests. Please try again in 300 seconds.');
  });

  it('allows successful login after earlier rate limit resolves', async () => {
    // 1st call throttled
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers({ 'retry-after': '10' }),
        text: async () =>
          JSON.stringify({
            success: false,
            error: { message: 'Too many requests. Please try again in 10 seconds.' },
          }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            success: true,
            data: {
              user: { id: 'u1', email: 'test@gramoz.com', role: 'customer' },
              accessToken: 'mock-access',
              refreshToken: 'mock-refresh',
            },
          }),
      } as unknown as Response);

    global.fetch = fetchMock;

    // First attempt rejected with 429
    await expect(
      authApi.login({ email: 'test@gramoz.com', password: 'password123' }),
    ).rejects.toThrow('Too many requests. Please try again in 10 seconds.');

    // Second attempt (after retry) succeeds
    const successRes = await authApi.login({
      email: 'test@gramoz.com',
      password: 'password123',
    });
    expect(successRes.success).toBe(true);
    expect(successRes.data?.user.email).toBe('test@gramoz.com');
  });
});
