/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import {
  ConflictException,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { AuthService } from './auth.service';
import { UsersStore } from '../users/users.store';
import { RedisService } from '../../cache/redis.service';
import { MailService } from '../notifications/mail.service';
import { SmsService } from '../notifications/sms.service';
import { ConfigService } from '../../config/config.service';
import { User } from '@database/schema';

describe('AuthService (Comprehensive Unit Tests — TASK-16)', () => {
  let authService: AuthService;
  let mockUsersStore: any;
  let mockJwtService: any;
  let mockRedisService: any;
  let mockMailService: any;
  let mockSmsService: any;
  let mockConfigService: any;

  const mockUser: User = {
    id: 'usr-101',
    email: 'test@gramoz.com',
    passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$somehash',
    fullName: 'Test User',
    phone: '+8801700000000',
    avatarUrl: null,
    provider: 'local',
    providerId: null,
    role: 'customer',
    isEmailVerified: false,
    isPhoneVerified: false,
    status: 'active',
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  beforeEach(() => {
    mockUsersStore = {
      findByEmail: jest.fn(),
      findById: jest.fn(),
      findByProviderId: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };

    mockJwtService = {
      sign: jest.fn().mockImplementation((payload, options) => {
        if (options?.expiresIn) return 'mock-refresh-token';
        return 'mock-access-token';
      }),
      verify: jest.fn(),
    };

    mockRedisService = {
      generateCode: jest.fn().mockReturnValue('12345678'),
      generate6DigitCode: jest.fn().mockReturnValue('123456'),
      setVerificationCode: jest.fn().mockResolvedValue(undefined),
      getVerificationCode: jest.fn(),
      deleteVerificationCode: jest.fn().mockResolvedValue(undefined),
      incrementVerifyAttempts: jest.fn(),
      clearVerifyAttempts: jest.fn().mockResolvedValue(undefined),
      setPhoneVerificationCode: jest.fn().mockResolvedValue(undefined),
      getPhoneVerificationCode: jest.fn(),
      deletePhoneVerificationCode: jest.fn().mockResolvedValue(undefined),
      incrementPhoneVerifyAttempts: jest.fn(),
      clearPhoneVerifyAttempts: jest.fn().mockResolvedValue(undefined),
      setResetCode: jest.fn().mockResolvedValue(undefined),
      getResetCode: jest.fn(),
      deleteResetCode: jest.fn().mockResolvedValue(undefined),
      incrementResetAttempts: jest.fn(),
      clearResetAttempts: jest.fn().mockResolvedValue(undefined),
      setSession: jest.fn().mockResolvedValue(undefined),
      getSession: jest.fn(),
      deleteSession: jest.fn().mockResolvedValue(undefined),
      rotateSession: jest.fn().mockResolvedValue(true),
      compareAndDeleteSession: jest.fn().mockResolvedValue(true),
    };

    mockMailService = {
      sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
      sendWelcomeEmail: jest.fn().mockResolvedValue(undefined),
      sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
    };

    mockSmsService = {
      sendVerificationSms: jest.fn().mockResolvedValue(undefined),
    };

    mockConfigService = {
      jwtSecret: 'test-jwt-secret-at-least-32-chars-long!',
      jwtExpiresIn: '15m',
      jwtRefreshExpiresIn: '7d',
      verifyEmailTokenExpiresIn: '4h',
      resetPasswordTokenExpiresIn: '1h',
    };

    authService = new AuthService(
      mockUsersStore as unknown as UsersStore,
      mockJwtService as unknown as JwtService,
      mockRedisService as unknown as RedisService,
      mockMailService as unknown as MailService,
      mockSmsService as unknown as SmsService,
      mockConfigService as unknown as ConfigService,
    );
  });

  describe('Registration Flow', () => {
    it('successfully registers new user with argon2 hash and dispatches verification email', async () => {
      mockUsersStore.findByEmail.mockResolvedValueOnce(null);
      mockUsersStore.create.mockResolvedValueOnce({
        ...mockUser,
        id: 'usr-new-1',
      });

      const result = await authService.register({
        email: 'newuser@gramoz.com',
        password: 'securePassword123!',
        fullName: 'New Customer',
        phone: '+8801711111111',
      });

      expect(result.success).toBe(true);
      expect(result.data.email).toBe(mockUser.email);
      expect(result.data).not.toHaveProperty('passwordHash');
      expect(mockUsersStore.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'newuser@gramoz.com',
          fullName: 'New Customer',
          status: 'active',
          isEmailVerified: false,
          isPhoneVerified: false,
        }),
      );
      expect(mockRedisService.setVerificationCode).toHaveBeenCalledWith(
        'test@gramoz.com',
        '12345678',
        '4h',
      );
      expect(mockMailService.sendVerificationEmail).toHaveBeenCalledWith(
        'test@gramoz.com',
        '12345678',
        'Test User',
      );
    });

    it('rejects registration with ConflictException if email is already registered', async () => {
      mockUsersStore.findByEmail.mockResolvedValueOnce(mockUser);

      await expect(
        authService.register({
          email: 'test@gramoz.com',
          password: 'Password123!',
          fullName: 'Duplicate User',
        }),
      ).rejects.toThrow(ConflictException);

      expect(mockUsersStore.create).not.toHaveBeenCalled();
      expect(mockMailService.sendVerificationEmail).not.toHaveBeenCalled();
    });
  });

  describe('Login Flow & Password Verification', () => {
    it('successfully logs in with valid credentials, sets Redis session and updates lastLoginAt', async () => {
      const plainPassword = 'correctPassword123!';
      const hash = await argon2.hash(plainPassword);
      mockUsersStore.findByEmail.mockResolvedValueOnce({
        ...mockUser,
        passwordHash: hash,
      });

      const result = await authService.login({
        email: 'test@gramoz.com',
        password: plainPassword,
      });

      expect(result.success).toBe(true);
      expect(result.data.accessToken).toBe('mock-access-token');
      expect(result.data.refreshToken).toBe('mock-refresh-token');
      expect(result.data.user).not.toHaveProperty('passwordHash');
      expect(mockRedisService.setSession).toHaveBeenCalledWith(
        mockUser.id,
        'mock-refresh-token',
        '7d',
      );
      expect(mockUsersStore.update).toHaveBeenCalledWith(
        mockUser.id,
        expect.objectContaining({ lastLoginAt: expect.any(Date) }),
      );
    });

    it('rejects login with 401 Unauthorized for unknown email without disclosing existence', async () => {
      mockUsersStore.findByEmail.mockResolvedValueOnce(null);

      await expect(
        authService.login({
          email: 'unknown@gramoz.com',
          password: 'somepassword',
        }),
      ).rejects.toThrow(new UnauthorizedException('Invalid credentials'));
    });

    it('rejects login with 401 Unauthorized for incorrect password', async () => {
      const hash = await argon2.hash('correctPassword123!');
      mockUsersStore.findByEmail.mockResolvedValueOnce({
        ...mockUser,
        passwordHash: hash,
      });

      await expect(
        authService.login({
          email: 'test@gramoz.com',
          password: 'wrongPassword999!',
        }),
      ).rejects.toThrow(new UnauthorizedException('Invalid credentials'));

      expect(mockRedisService.setSession).not.toHaveBeenCalled();
    });

    it('DEFECT FIX: rejects login on OAuth user (null passwordHash) with 401 instead of crashing with 500', async () => {
      // User registered via OAuth has null passwordHash in PostgreSQL
      mockUsersStore.findByEmail.mockResolvedValueOnce({
        ...mockUser,
        provider: 'google',
        passwordHash: null,
      });

      await expect(
        authService.login({
          email: 'test@gramoz.com',
          password: 'anyPassword123!',
        }),
      ).rejects.toThrow(new UnauthorizedException('Invalid credentials'));
    });

    it('rejects login with 401 Unauthorized if user account is suspended', async () => {
      const hash = await argon2.hash('correctPassword123!');
      mockUsersStore.findByEmail.mockResolvedValueOnce({
        ...mockUser,
        passwordHash: hash,
        status: 'suspended',
      });

      await expect(
        authService.login({
          email: 'test@gramoz.com',
          password: 'correctPassword123!',
        }),
      ).rejects.toThrow(
        new UnauthorizedException('Account is suspended or deleted'),
      );
    });

    it('rejects login with 401 Unauthorized if user account is deleted', async () => {
      const hash = await argon2.hash('correctPassword123!');
      mockUsersStore.findByEmail.mockResolvedValueOnce({
        ...mockUser,
        passwordHash: hash,
        status: 'deleted',
      });

      await expect(
        authService.login({
          email: 'test@gramoz.com',
          password: 'correctPassword123!',
        }),
      ).rejects.toThrow(
        new UnauthorizedException('Account is suspended or deleted'),
      );
    });
  });

  describe('Token Refresh Flow', () => {
    it('successfully issues refreshed tokens when refresh token matches active Redis session via atomic CAS', async () => {
      const validToken = 'valid-refresh-token';
      mockJwtService.verify.mockReturnValueOnce({
        sub: mockUser.id,
        email: mockUser.email,
        role: mockUser.role,
        token_type: 'refresh',
      });
      mockUsersStore.findById.mockResolvedValueOnce(mockUser);
      mockRedisService.rotateSession.mockResolvedValueOnce(true);

      const result = await authService.refreshToken(validToken);

      expect(result.success).toBe(true);
      expect(result.data.accessToken).toBe('mock-access-token');
      expect(result.data.refreshToken).toBe('mock-refresh-token');
      expect(mockRedisService.rotateSession).toHaveBeenCalledWith(
        mockUser.id,
        validToken,
        'mock-refresh-token',
        '7d',
      );
    });

    it('rejects refresh when token is missing', async () => {
      await expect(authService.refreshToken('')).rejects.toThrow(
        new UnauthorizedException('No refresh token provided'),
      );
    });

    it('rejects refresh when token_type is access instead of refresh', async () => {
      mockJwtService.verify.mockReturnValueOnce({
        sub: mockUser.id,
        email: mockUser.email,
        role: mockUser.role,
        token_type: 'access',
      });

      await expect(
        authService.refreshToken('access-token-presented'),
      ).rejects.toThrow(new UnauthorizedException('Invalid refresh token'));
      expect(mockRedisService.rotateSession).not.toHaveBeenCalled();
    });

    it('rejects refresh when rotateSession fails (replayed token, superseded token, or missing Redis session)', async () => {
      mockJwtService.verify.mockReturnValueOnce({
        sub: mockUser.id,
        token_type: 'refresh',
      });
      mockUsersStore.findById.mockResolvedValueOnce(mockUser);
      mockRedisService.rotateSession.mockResolvedValueOnce(false); // CAS failure

      await expect(authService.refreshToken('stale-token')).rejects.toThrow(
        new UnauthorizedException('Invalid refresh token'),
      );
    });

    it('rejects refresh when user is suspended or deleted', async () => {
      mockJwtService.verify.mockReturnValueOnce({
        sub: mockUser.id,
        token_type: 'refresh',
      });
      mockUsersStore.findById.mockResolvedValueOnce({
        ...mockUser,
        status: 'suspended',
      });

      await expect(authService.refreshToken('my-token')).rejects.toThrow(
        new UnauthorizedException('User inactive or not found'),
      );
      expect(mockUsersStore.findById).toHaveBeenCalledWith(mockUser.id, {
        skipCache: true,
      });
      expect(mockRedisService.rotateSession).not.toHaveBeenCalled();
    });
  });

  describe('Logout & Session Revocation (B-AUTH-06)', () => {
    it('revokes Redis session via atomic compare-and-delete when called with a valid refresh token', async () => {
      mockJwtService.verify.mockReturnValueOnce({
        sub: 'user-to-logout',
        token_type: 'refresh',
      });

      const result = await authService.logout('header.payload.signature');

      expect(result.success).toBe(true);
      expect(mockRedisService.compareAndDeleteSession).toHaveBeenCalledWith(
        'user-to-logout',
        'header.payload.signature',
      );
    });

    it('does not revoke session when an access token is presented to logout', async () => {
      mockJwtService.verify.mockReturnValueOnce({
        sub: 'user-to-logout',
        token_type: 'access',
      });

      const result = await authService.logout('header.payload.signature');

      expect(result.success).toBe(true);
      expect(mockRedisService.compareAndDeleteSession).not.toHaveBeenCalled();
    });

    it('deletes session directly when called with userId', async () => {
      const result = await authService.logout('user-uuid-123');

      expect(result.success).toBe(true);
      expect(mockRedisService.deleteSession).toHaveBeenCalledWith(
        'user-uuid-123',
      );
    });

    it('gracefully exits with success when token is invalid or expired without crashing', async () => {
      mockJwtService.verify.mockImplementationOnce(() => {
        throw new Error('jwt expired');
      });

      const result = await authService.logout('expired.token.here');

      expect(result.success).toBe(true);
      expect(mockRedisService.compareAndDeleteSession).not.toHaveBeenCalled();
      expect(mockRedisService.deleteSession).not.toHaveBeenCalled();
    });
  });

  describe('Email Verification & Brute-Force Safeguards (B-AUTH-07, B-AUTH-08)', () => {
    it('verifies email, clears Redis code and attempts, and sends welcome email', async () => {
      mockRedisService.getVerificationCode.mockResolvedValueOnce('12345678');
      mockRedisService.incrementVerifyAttempts.mockResolvedValueOnce(1);
      mockUsersStore.findByEmail.mockResolvedValueOnce(mockUser);

      const result = await authService.verifyEmail({
        email: 'test@gramoz.com',
        code: '12345678',
      });

      expect(result.success).toBe(true);
      expect(mockUsersStore.update).toHaveBeenCalledWith(mockUser.id, {
        isEmailVerified: true,
      });
      expect(mockRedisService.deleteVerificationCode).toHaveBeenCalledWith(
        'test@gramoz.com',
      );
      expect(mockRedisService.clearVerifyAttempts).toHaveBeenCalledWith(
        'test@gramoz.com',
      );
      expect(mockMailService.sendWelcomeEmail).toHaveBeenCalledWith(
        mockUser.email,
        mockUser.fullName,
      );
    });

    it('rejects verification if code is expired or absent from Redis', async () => {
      mockRedisService.getVerificationCode.mockResolvedValueOnce(null);

      await expect(
        authService.verifyEmail({ email: 'test@gramoz.com', code: '12345678' }),
      ).rejects.toThrow(
        new BadRequestException('Verification code expired or invalid'),
      );
    });

    it('invalidates code and permanently locks when failed verify attempts exceed 5 (Brute Force Guard)', async () => {
      mockRedisService.getVerificationCode.mockResolvedValueOnce('12345678');
      mockRedisService.incrementVerifyAttempts.mockResolvedValueOnce(6); // 6th attempt

      await expect(
        authService.verifyEmail({ email: 'test@gramoz.com', code: '12345678' }),
      ).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringContaining('Too many failed attempts'),
        }),
      );

      expect(mockRedisService.deleteVerificationCode).toHaveBeenCalledWith(
        'test@gramoz.com',
      );
      expect(mockRedisService.clearVerifyAttempts).toHaveBeenCalledWith(
        'test@gramoz.com',
      );
      expect(mockUsersStore.update).not.toHaveBeenCalled();
    });

    it('reports remaining attempts when incorrect code is submitted', async () => {
      mockRedisService.getVerificationCode.mockResolvedValueOnce('12345678');
      mockRedisService.incrementVerifyAttempts.mockResolvedValueOnce(3); // 3rd attempt (2 remaining)

      await expect(
        authService.verifyEmail({ email: 'test@gramoz.com', code: '00000000' }),
      ).rejects.toThrow(
        expect.objectContaining({
          message: 'Invalid verification code. 2 attempt(s) remaining.',
        }),
      );

      expect(mockUsersStore.update).not.toHaveBeenCalled();
    });
  });

  describe('Resend Verification Flow', () => {
    it('generates new verification code and dispatches email', async () => {
      mockUsersStore.findByEmail.mockResolvedValueOnce({
        ...mockUser,
        isEmailVerified: false,
      });

      const result = await authService.resendVerification('test@gramoz.com');

      expect(result.success).toBe(true);
      expect(mockRedisService.setVerificationCode).toHaveBeenCalledWith(
        'test@gramoz.com',
        '12345678',
        '4h',
      );
      expect(mockMailService.sendVerificationEmail).toHaveBeenCalled();
    });

    it('throws 404 NotFoundException if user does not exist', async () => {
      mockUsersStore.findByEmail.mockResolvedValueOnce(null);

      await expect(
        authService.resendVerification('unknown@gramoz.com'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws 400 BadRequestException if user is already verified', async () => {
      mockUsersStore.findByEmail.mockResolvedValueOnce({
        ...mockUser,
        isEmailVerified: true,
      });

      await expect(
        authService.resendVerification('test@gramoz.com'),
      ).rejects.toThrow(new BadRequestException('Email already verified'));
    });
  });

  describe('Phone SMS OTP Flow (B-AUTH-09, B-AUTH-10)', () => {
    it('dispatches 6-digit SMS OTP when phone is not yet verified', async () => {
      const result = await authService.sendPhoneOtp(mockUser, '+8801722222222');

      expect(result.success).toBe(true);
      expect(mockRedisService.setPhoneVerificationCode).toHaveBeenCalledWith(
        '+8801722222222',
        '123456',
        '10m',
      );
      expect(mockSmsService.sendVerificationSms).toHaveBeenCalledWith(
        '+8801722222222',
        '123456',
      );
    });

    it('rejects sendPhoneOtp if phone number is already verified on this account', async () => {
      const verifiedUser: User = {
        ...mockUser,
        phone: '+8801700000000',
        isPhoneVerified: true,
      };

      await expect(
        authService.sendPhoneOtp(verifiedUser, '+8801700000000'),
      ).rejects.toThrow(
        new BadRequestException('Phone number is already verified'),
      );
    });

    it('successfully verifies phone OTP, updates user phone and isPhoneVerified', async () => {
      mockRedisService.getPhoneVerificationCode.mockResolvedValueOnce('123456');
      mockRedisService.incrementPhoneVerifyAttempts.mockResolvedValueOnce(1);

      const result = await authService.verifyPhoneOtp(mockUser, {
        phone: '+8801722222222',
        code: '123456',
      });

      expect(result.success).toBe(true);
      expect(mockUsersStore.update).toHaveBeenCalledWith(mockUser.id, {
        phone: '+8801722222222',
        isPhoneVerified: true,
      });
      expect(mockRedisService.deletePhoneVerificationCode).toHaveBeenCalledWith(
        '+8801722222222',
      );
      expect(mockRedisService.clearPhoneVerifyAttempts).toHaveBeenCalledWith(
        '+8801722222222',
      );
    });

    it('locks out phone verification after 5 failed attempts (Brute Force Guard)', async () => {
      mockRedisService.getPhoneVerificationCode.mockResolvedValueOnce('123456');
      mockRedisService.incrementPhoneVerifyAttempts.mockResolvedValueOnce(6);

      await expect(
        authService.verifyPhoneOtp(mockUser, {
          phone: '+8801722222222',
          code: '123456',
        }),
      ).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringContaining('Too many failed attempts'),
        }),
      );

      expect(mockRedisService.deletePhoneVerificationCode).toHaveBeenCalledWith(
        '+8801722222222',
      );
    });
  });

  describe('Password Reset Flow (B-AUTH-11)', () => {
    it('forgotPassword generates reset code for existing user without leaking account info', async () => {
      mockUsersStore.findByEmail.mockResolvedValueOnce(mockUser);

      const result = await authService.forgotPassword({
        email: 'test@gramoz.com',
      });

      expect(result.success).toBe(true);
      expect(result.message).toBe(
        'If the email exists, a reset code has been sent',
      );
      expect(mockRedisService.setResetCode).toHaveBeenCalledWith(
        mockUser.email,
        '12345678',
        '1h',
      );
      expect(mockMailService.sendPasswordResetEmail).toHaveBeenCalled();
    });

    it('forgotPassword returns neutral response for non-existent email (Zero Enumeration)', async () => {
      mockUsersStore.findByEmail.mockResolvedValueOnce(null);

      const result = await authService.forgotPassword({
        email: 'ghost@gramoz.com',
      });

      expect(result.success).toBe(true);
      expect(result.message).toBe(
        'If the email exists, a reset code has been sent',
      );
      expect(mockRedisService.setResetCode).not.toHaveBeenCalled();
      expect(mockMailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('resetPassword updates password with new Argon2 hash and invalidates active session', async () => {
      mockRedisService.getResetCode.mockResolvedValueOnce('87654321');
      mockRedisService.incrementResetAttempts.mockResolvedValueOnce(1);
      mockUsersStore.findByEmail.mockResolvedValueOnce(mockUser);

      const result = await authService.resetPassword({
        email: 'test@gramoz.com',
        code: '87654321',
        newPassword: 'BrandNewSecurePassword456!',
      });

      expect(result.success).toBe(true);
      expect(mockUsersStore.update).toHaveBeenCalledWith(
        mockUser.id,
        expect.objectContaining({
          passwordHash: expect.stringMatching(/^\$argon2id\$/),
        }),
      );
      expect(mockRedisService.deleteResetCode).toHaveBeenCalledWith(
        'test@gramoz.com',
      );
      expect(mockRedisService.clearResetAttempts).toHaveBeenCalledWith(
        'test@gramoz.com',
      );
      expect(mockRedisService.deleteSession).toHaveBeenCalledWith(mockUser.id);
    });

    it('resetPassword enforces brute force protection and invalidates code after 5 failures', async () => {
      mockRedisService.getResetCode.mockResolvedValueOnce('87654321');
      mockRedisService.incrementResetAttempts.mockResolvedValueOnce(6);

      await expect(
        authService.resetPassword({
          email: 'test@gramoz.com',
          code: '87654321',
          newPassword: 'NewPassword123!',
        }),
      ).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringContaining('Too many failed attempts'),
        }),
      );

      expect(mockRedisService.deleteResetCode).toHaveBeenCalledWith(
        'test@gramoz.com',
      );
      expect(mockRedisService.clearResetAttempts).toHaveBeenCalledWith(
        'test@gramoz.com',
      );
      expect(mockUsersStore.update).not.toHaveBeenCalled();
    });
  });

  describe('User Profile (`getMe`)', () => {
    it('returns sanitized user profile without sensitive passwordHash or internal fields', async () => {
      const result = await authService.getMe(mockUser);

      expect(result.success).toBe(true);
      expect(result.data.id).toBe(mockUser.id);
      expect(result.data.email).toBe(mockUser.email);
      expect(result.data.role).toBe(mockUser.role);
      expect(result.data).not.toHaveProperty('passwordHash');
      expect(result.data).not.toHaveProperty('providerId');
    });
  });

  describe('OAuth Validation (`validateOAuthUser`)', () => {
    it('authenticates existing user matched by provider and providerId', async () => {
      const oauthUser: User = {
        ...mockUser,
        provider: 'google',
        providerId: 'google-uid-999',
      };
      mockUsersStore.findByProviderId.mockResolvedValueOnce(oauthUser);

      const result = await authService.validateOAuthUser({
        provider: 'google',
        id: 'google-uid-999',
        email: 'oauth@gmail.com',
        fullName: 'Google User',
        picture: 'https://avatar.url',
      });

      expect(result.user.id).toBe(oauthUser.id);
      expect(result.accessToken).toBe('mock-access-token');
      expect(result.refreshToken).toBe('mock-refresh-token');
      expect(mockRedisService.setSession).toHaveBeenCalledWith(
        oauthUser.id,
        'mock-refresh-token',
        '7d',
      );
    });

    it('links OAuth account to existing local user matching same email', async () => {
      mockUsersStore.findByProviderId.mockResolvedValueOnce(null);
      mockUsersStore.findByEmail.mockResolvedValueOnce(mockUser);
      mockUsersStore.findById.mockResolvedValueOnce({
        ...mockUser,
        provider: 'google',
        providerId: 'google-uid-101',
      });

      const result = await authService.validateOAuthUser({
        provider: 'google',
        id: 'google-uid-101',
        email: mockUser.email,
        fullName: mockUser.fullName,
      });

      expect(mockUsersStore.update).toHaveBeenCalledWith(
        mockUser.id,
        expect.objectContaining({
          provider: 'google',
          providerId: 'google-uid-101',
          isEmailVerified: true,
        }),
      );
      expect(result.accessToken).toBe('mock-access-token');
    });

    it('creates brand new user if neither providerId nor email matches existing record', async () => {
      mockUsersStore.findByProviderId.mockResolvedValueOnce(null);
      mockUsersStore.findByEmail.mockResolvedValueOnce(null);
      const newOauthUser: User = {
        ...mockUser,
        id: 'oauth-new-1',
        email: 'brandnew@facebook.com',
        provider: 'facebook',
        providerId: 'fb-12345',
        passwordHash: null,
      };
      mockUsersStore.create.mockResolvedValueOnce(newOauthUser);

      const result = await authService.validateOAuthUser({
        provider: 'facebook',
        id: 'fb-12345',
        email: 'brandnew@facebook.com',
        fullName: 'FB User',
      });

      expect(result.user.id).toBe('oauth-new-1');
      expect(mockUsersStore.create).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'facebook',
          providerId: 'fb-12345',
          passwordHash: null,
          isEmailVerified: true,
        }),
      );
    });

    it('rejects OAuth user with 401 Unauthorized if account status is suspended or deleted', async () => {
      mockUsersStore.findByProviderId.mockResolvedValueOnce({
        ...mockUser,
        status: 'suspended',
      });

      await expect(
        authService.validateOAuthUser({
          provider: 'google',
          id: 'g-suspended',
          email: 'suspended@google.com',
          fullName: 'Suspended User',
        }),
      ).rejects.toThrow(
        new UnauthorizedException('Account is suspended or deleted'),
      );
    });
  });
});
