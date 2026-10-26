/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ConfigService } from '../../config/config.service';

describe('AuthController (Unit & HTTP Transport Tests — TASK-16)', () => {
  let controller: AuthController;
  let mockAuthService: any;
  let mockConfigService: any;

  beforeEach(() => {
    mockAuthService = {
      register: jest.fn(),
      login: jest.fn(),
      refreshToken: jest.fn(),
      logout: jest.fn().mockResolvedValue({
        success: true,
        message: 'Logged out successfully',
      }),
      verifyEmail: jest.fn(),
      resendVerification: jest.fn(),
      forgotPassword: jest.fn(),
      resetPassword: jest.fn(),
      sendPhoneOtp: jest.fn(),
      verifyPhoneOtp: jest.fn(),
      getMe: jest.fn(),
      validateOAuthUser: jest.fn(),
    };

    mockConfigService = {
      googleClientId: 'google-client-id-test',
      googleClientSecret: 'google-client-secret-test',
      googleCallbackUrl: 'http://localhost:4000/auth/google/callback',
      facebookAppId: 'facebook-app-id-test',
      facebookAppSecret: 'facebook-app-secret-test',
      facebookCallbackUrl: 'http://localhost:4000/auth/facebook/callback',
      frontendUrl: 'http://localhost:3000',
    };

    controller = new AuthController(
      mockAuthService as unknown as AuthService,
      mockConfigService as unknown as ConfigService,
    );
  });

  describe('Login Cookie Transport', () => {
    it('sets secure httpOnly cookies for both access_token and refresh_token on successful login', async () => {
      mockAuthService.login.mockResolvedValueOnce({
        success: true,
        message: 'Login successful',
        data: {
          user: { id: 'u1', email: 'test@gramoz.com', role: 'customer' },
          accessToken: 'signed.access.token',
          refreshToken: 'signed.refresh.token',
        },
      });

      const mockReply: any = {
        setCookie: jest.fn(),
      };

      const result = await controller.login(
        { email: 'test@gramoz.com', password: 'password123' },
        mockReply,
      );

      expect(result.success).toBe(true);
      expect(mockReply.setCookie).toHaveBeenCalledTimes(2);

      // Access token cookie
      expect(mockReply.setCookie).toHaveBeenCalledWith(
        'access_token',
        'signed.access.token',
        expect.objectContaining({
          httpOnly: true,
          sameSite: 'strict',
          path: '/',
          maxAge: 15 * 60, // 15 minutes
        }),
      );

      // Refresh token cookie
      expect(mockReply.setCookie).toHaveBeenCalledWith(
        'refresh_token',
        'signed.refresh.token',
        expect.objectContaining({
          httpOnly: true,
          sameSite: 'strict',
          path: '/',
          maxAge: 7 * 24 * 60 * 60, // 7 days
        }),
      );
    });
  });

  describe('Token Refresh Cookie Transport', () => {
    it('reads refresh_token cookie, refreshes tokens, and emits updated cookies', async () => {
      const mockRequest: any = {
        cookies: { refresh_token: 'existing.refresh.token' },
      };
      const mockReply: any = {
        setCookie: jest.fn(),
      };

      mockAuthService.refreshToken.mockResolvedValueOnce({
        success: true,
        data: {
          accessToken: 'new.access.token',
          refreshToken: 'new.refresh.token',
        },
      });

      const result = await controller.refresh(mockRequest, mockReply);

      expect(result.success).toBe(true);
      expect(mockAuthService.refreshToken).toHaveBeenCalledWith(
        'existing.refresh.token',
      );
      expect(mockReply.setCookie).toHaveBeenCalledWith(
        'access_token',
        'new.access.token',
        expect.objectContaining({ httpOnly: true, maxAge: 15 * 60 }),
      );
      expect(mockReply.setCookie).toHaveBeenCalledWith(
        'refresh_token',
        'new.refresh.token',
        expect.objectContaining({ httpOnly: true, maxAge: 7 * 24 * 60 * 60 }),
      );
    });
  });

  describe('Logout & Session Revocation Transport (B-AUTH-06)', () => {
    it('revokes server-side session in Redis via refresh token and clears both cookies', async () => {
      const mockRequest: any = {
        cookies: { refresh_token: 'active.refresh.token' },
      };
      const mockReply: any = {
        clearCookie: jest.fn(),
      };

      const result = await controller.logout(mockRequest, mockReply);

      expect(result.success).toBe(true);
      expect(mockAuthService.logout).toHaveBeenCalledWith(
        'active.refresh.token',
      );
      expect(mockReply.clearCookie).toHaveBeenCalledWith('access_token', {
        path: '/',
      });
      expect(mockReply.clearCookie).toHaveBeenCalledWith('refresh_token', {
        path: '/',
      });
    });

    it('gracefully clears cookies even if no refresh_token cookie was present', async () => {
      const mockRequest: any = { cookies: {} };
      const mockReply: any = { clearCookie: jest.fn() };

      const result = await controller.logout(mockRequest, mockReply);

      expect(result.success).toBe(true);
      expect(mockReply.clearCookie).toHaveBeenCalledWith('access_token', {
        path: '/',
      });
      expect(mockReply.clearCookie).toHaveBeenCalledWith('refresh_token', {
        path: '/',
      });
    });
  });

  describe('Google OAuth CSRF State Protection', () => {
    it('redirects to Google with random CSRF state and stores signed httpOnly state cookie', async () => {
      let locationHeader = '';
      const mockReply: any = {
        setCookie: jest.fn(),
        code: jest.fn().mockReturnThis(),
        header: jest.fn().mockImplementation((name, val) => {
          if (name === 'Location') locationHeader = val;
          return mockReply;
        }),
        send: jest.fn(),
      };

      await controller.googleLogin(mockReply);

      expect(mockReply.code).toHaveBeenCalledWith(302);
      expect(locationHeader).toContain(
        'https://accounts.google.com/o/oauth2/v2/auth',
      );
      expect(locationHeader).toContain('client_id=google-client-id-test');
      expect(locationHeader).toContain('state=');

      expect(mockReply.setCookie).toHaveBeenCalledWith(
        'oauth_state',
        expect.any(String),
        expect.objectContaining({
          httpOnly: true,
          sameSite: 'lax',
          signed: true,
          maxAge: 300,
        }),
      );
    });

    it('rejects callback if CSRF state does not match signed cookie', async () => {
      let redirectLocation = '';
      const mockRequest: any = {
        cookies: { oauth_state: 'signed-cookie-value' },
        unsignCookie: jest
          .fn()
          .mockReturnValue({ valid: true, value: 'original-nonce' }),
      };
      const mockReply: any = {
        clearCookie: jest.fn(),
        code: jest.fn().mockReturnThis(),
        header: jest.fn().mockImplementation((name, val) => {
          if (name === 'Location') redirectLocation = val;
          return mockReply;
        }),
        send: jest.fn(),
      };

      await controller.googleCallback(
        'some-code',
        '',
        'attacker-tampered-state',
        mockRequest,
        mockReply,
      );

      expect(redirectLocation).toBe(
        'http://localhost:3000/login?error=oauth_state_mismatch',
      );
      expect(mockReply.clearCookie).toHaveBeenCalledWith('oauth_state', {
        path: '/',
      });
      expect(mockAuthService.validateOAuthUser).not.toHaveBeenCalled();
    });

    it('redirects to login error when user denies OAuth permission', async () => {
      let redirectLocation = '';
      const mockRequest: any = {
        cookies: {},
        unsignCookie: jest.fn().mockReturnValue({ valid: false }),
      };
      const mockReply: any = {
        clearCookie: jest.fn(),
        code: jest.fn().mockReturnThis(),
        header: jest.fn().mockImplementation((name, val) => {
          if (name === 'Location') redirectLocation = val;
          return mockReply;
        }),
        send: jest.fn(),
      };

      await controller.googleCallback(
        '',
        'access_denied',
        'some-state',
        mockRequest,
        mockReply,
      );

      expect(redirectLocation).toBe(
        'http://localhost:3000/login?error=oauth_denied',
      );
    });
  });

  describe('Facebook OAuth CSRF State Protection', () => {
    it('redirects to Facebook with random CSRF state and stores signed httpOnly state cookie', async () => {
      let locationHeader = '';
      const mockReply: any = {
        setCookie: jest.fn(),
        code: jest.fn().mockReturnThis(),
        header: jest.fn().mockImplementation((name, val) => {
          if (name === 'Location') locationHeader = val;
          return mockReply;
        }),
        send: jest.fn(),
      };

      await controller.facebookLogin(mockReply);

      expect(mockReply.code).toHaveBeenCalledWith(302);
      expect(locationHeader).toContain(
        'https://www.facebook.com/v19.0/dialog/oauth',
      );
      expect(locationHeader).toContain('client_id=facebook-app-id-test');
      expect(mockReply.setCookie).toHaveBeenCalledWith(
        'oauth_state',
        expect.any(String),
        expect.objectContaining({ httpOnly: true, signed: true, maxAge: 300 }),
      );
    });

    it('rejects Facebook callback when state is missing or invalid', async () => {
      let redirectLocation = '';
      const mockRequest: any = {
        cookies: {},
        unsignCookie: jest.fn().mockReturnValue({ valid: false }),
      };
      const mockReply: any = {
        clearCookie: jest.fn(),
        code: jest.fn().mockReturnThis(),
        header: jest.fn().mockImplementation((name, val) => {
          if (name === 'Location') redirectLocation = val;
          return mockReply;
        }),
        send: jest.fn(),
      };

      await controller.facebookCallback(
        'code-123',
        '',
        'state-123',
        mockRequest,
        mockReply,
      );

      expect(redirectLocation).toBe(
        'http://localhost:3000/login?error=oauth_state_mismatch',
      );
      expect(mockReply.clearCookie).toHaveBeenCalledWith('oauth_state', {
        path: '/',
      });
    });
  });
});
