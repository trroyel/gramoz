import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { ConfigService } from '@config/config.service';
import { RedisService } from '@cache/redis.service';
import { UsersStore } from '@modules/users/users.store';
import { MailService } from '../notifications/mail.service';
import { SmsService } from '../notifications/sms.service';
import { RegisterDto } from './dto/register.dto';
import { VerifyPhoneOtpDto } from './dto/verify-phone-otp.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { User } from '@database/schema';

export interface OAuthProfile {
  provider: 'google' | 'facebook';
  id: string;
  email: string;
  fullName: string;
  picture?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersStore: UsersStore,
    private readonly jwtService: JwtService,
    private readonly redis: RedisService,
    private readonly mail: MailService,
    private readonly sms: SmsService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    // Check if user exists
    const existingUser = await this.usersStore.findByEmail(dto.email);
    if (existingUser) {
      throw new ConflictException('Email already registered');
    }

    // Hash password
    const passwordHash = await argon2.hash(dto.password);

    // Create user
    let user: User;
    try {
      user = await this.usersStore.create({
        email: dto.email,
        passwordHash,
        fullName: dto.fullName,
        phone: dto.phone,
        isEmailVerified: false,
        isPhoneVerified: false,
        status: 'active',
      });
    } catch (err: unknown) {
      const pgErr = err as { code?: string; cause?: { code?: string } };
      const code = pgErr?.code || pgErr?.cause?.code;
      if (code === '23505') {
        throw new ConflictException('Email already registered');
      }
      throw err;
    }

    // Generate verification code
    const code = this.redis.generateCode();
    await this.redis.setVerificationCode(
      user.email,
      code,
      this.config.verifyEmailTokenExpiresIn,
    );

    // Send verification email
    await this.mail.sendVerificationEmail(user.email, code, user.fullName);

    return {
      success: true,
      message:
        'Registration successful. Please check your email for verification code.',
      data: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
      },
    };
  }

  async login(dto: LoginDto) {
    // Find user
    const user = await this.usersStore.findByEmail(dto.email);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check password
    if (!user.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await argon2.verify(
      user.passwordHash,
      dto.password,
    );
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check if user is active
    if (user.status !== 'active') {
      throw new UnauthorizedException('Account is suspended or deleted');
    }

    // Generate JWT tokens
    const { accessToken, refreshToken } = await this.generateTokens(user);

    // Store session in Redis
    await this.redis.setSession(
      user.id,
      refreshToken,
      this.config.jwtRefreshExpiresIn,
    );

    // Update last login
    await this.usersStore.update(user.id, { lastLoginAt: new Date() });

    return {
      success: true,
      message: 'Login successful',
      data: {
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          role: user.role,
          isEmailVerified: user.isEmailVerified,
        },
        accessToken,
        refreshToken,
      },
    };
  }

  async verifyEmail(dto: VerifyEmailDto) {
    // Get stored code — expired or never-sent codes return null
    const storedCode = await this.redis.getVerificationCode(dto.email);
    if (!storedCode) {
      throw new BadRequestException('Verification code expired or invalid');
    }

    // Brute-force protection: increment BEFORE comparing so a correct guess
    // on the 6th attempt is still rejected (counter already at MAX).
    const MAX_ATTEMPTS = 5;
    const attempts = await this.redis.incrementVerifyAttempts(dto.email);

    if (attempts > MAX_ATTEMPTS) {
      // Invalidate the code so the attacker can't keep trying with a fresh rate limit
      await this.redis.deleteVerificationCode(dto.email);
      await this.redis.clearVerifyAttempts(dto.email);
      throw new BadRequestException(
        'Too many failed attempts. Your verification code has been invalidated — please request a new one.',
      );
    }

    if (storedCode !== dto.code) {
      const remaining = MAX_ATTEMPTS - attempts;
      throw new BadRequestException(
        remaining > 0
          ? `Invalid verification code. ${remaining} attempt(s) remaining.`
          : 'Invalid verification code. No attempts remaining — please request a new code.',
      );
    }

    // Code is correct — clear both the code and the attempt counter
    await this.redis.deleteVerificationCode(dto.email);
    await this.redis.clearVerifyAttempts(dto.email);

    // Find user
    const user = await this.usersStore.findByEmail(dto.email);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Update user
    await this.usersStore.update(user.id, { isEmailVerified: true });

    // Send welcome email
    await this.mail.sendWelcomeEmail(user.email, user.fullName);

    return {
      success: true,
      message: 'Email verified successfully',
      data: null,
    };
  }

  async resendVerification(email: string) {
    // Find user
    const user = await this.usersStore.findByEmail(email);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Check if already verified
    if (user.isEmailVerified) {
      throw new BadRequestException('Email already verified');
    }

    // Generate new code
    const code = this.redis.generateCode();
    await this.redis.setVerificationCode(
      user.email,
      code,
      this.config.verifyEmailTokenExpiresIn,
    );

    // Send verification email
    await this.mail.sendVerificationEmail(user.email, code, user.fullName);

    return {
      success: true,
      message: 'Verification code sent to your email',
      data: null,
    };
  }

  async sendPhoneOtp(user: User, phone: string) {
    if (user.isPhoneVerified && user.phone === phone) {
      throw new BadRequestException('Phone number is already verified');
    }

    // Generate 6-digit code
    const code = this.redis.generate6DigitCode();
    await this.redis.setPhoneVerificationCode(
      phone,
      code,
      '10m', // 10 minutes expiry
    );

    // Send verification SMS
    await this.sms.sendVerificationSms(phone, code);

    return {
      success: true,
      message: 'Verification code sent to your phone',
      data: null,
    };
  }

  async verifyPhoneOtp(user: User, dto: VerifyPhoneOtpDto) {
    // Get stored code
    const storedCode = await this.redis.getPhoneVerificationCode(dto.phone);
    if (!storedCode) {
      throw new BadRequestException('Verification code expired or invalid');
    }

    const MAX_ATTEMPTS = 5;
    const attempts = await this.redis.incrementPhoneVerifyAttempts(dto.phone);

    if (attempts > MAX_ATTEMPTS) {
      await this.redis.deletePhoneVerificationCode(dto.phone);
      await this.redis.clearPhoneVerifyAttempts(dto.phone);
      throw new BadRequestException(
        'Too many failed attempts. Your verification code has been invalidated — please request a new one.',
      );
    }

    if (storedCode !== dto.code) {
      const remaining = MAX_ATTEMPTS - attempts;
      throw new BadRequestException(
        remaining > 0
          ? `Invalid verification code. ${remaining} attempt(s) remaining.`
          : 'Invalid verification code. No attempts remaining — please request a new code.',
      );
    }

    // Code is correct
    await this.redis.deletePhoneVerificationCode(dto.phone);
    await this.redis.clearPhoneVerifyAttempts(dto.phone);

    // Update user
    await this.usersStore.update(user.id, {
      phone: dto.phone,
      isPhoneVerified: true,
    });

    return {
      success: true,
      message: 'Phone number verified successfully',
      data: null,
    };
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    // Find user
    const user = await this.usersStore.findByEmail(dto.email);
    if (!user) {
      // Don't reveal if user exists
      return {
        success: true,
        message: 'If the email exists, a reset code has been sent',
        data: null,
      };
    }

    // Generate reset code
    const code = this.redis.generateCode();
    await this.redis.setResetCode(
      user.email,
      code,
      this.config.resetPasswordTokenExpiresIn,
    );

    // Send reset email
    await this.mail.sendPasswordResetEmail(user.email, code, user.fullName);

    return {
      success: true,
      message: 'If the email exists, a reset code has been sent',
      data: null,
    };
  }

  async resetPassword(dto: ResetPasswordDto) {
    // Get stored code
    const storedCode = await this.redis.getResetCode(dto.email);
    if (!storedCode) {
      throw new BadRequestException('Reset code expired or invalid');
    }

    const MAX_ATTEMPTS = 5;
    const attempts = await this.redis.incrementResetAttempts(dto.email);

    if (attempts > MAX_ATTEMPTS) {
      await this.redis.deleteResetCode(dto.email);
      await this.redis.clearResetAttempts(dto.email);
      throw new BadRequestException(
        'Too many failed attempts. Your reset code has been invalidated — please request a new one.',
      );
    }

    // Verify code
    if (storedCode !== dto.code) {
      const remaining = MAX_ATTEMPTS - attempts;
      throw new BadRequestException(
        remaining > 0
          ? `Invalid reset code. ${remaining} attempt(s) remaining.`
          : 'Invalid reset code. No attempts remaining — please request a new code.',
      );
    }

    // Code is correct — clear both code and attempt counter
    await this.redis.deleteResetCode(dto.email);
    await this.redis.clearResetAttempts(dto.email);

    // Find user
    const user = await this.usersStore.findByEmail(dto.email);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Hash new password
    const passwordHash = await argon2.hash(dto.newPassword);

    // Update password
    await this.usersStore.update(user.id, { passwordHash });

    // Delete session (force re-login)
    await this.redis.deleteSession(user.id);

    return {
      success: true,
      message:
        'Password reset successfully. Please login with your new password.',
      data: null,
    };
  }

  /* eslint-disable-next-line @typescript-eslint/require-await */
  async getMe(user: User) {
    return {
      success: true,
      message: 'User profile retrieved',
      data: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        avatarUrl: user.avatarUrl,
        role: user.role,
        phone: user.phone,
        isEmailVerified: user.isEmailVerified,
        isPhoneVerified: user.isPhoneVerified,
        status: user.status,
        createdAt: user.createdAt,
      },
    };
  }

  /**
   * Find or create a user based on their OAuth profile.
   * Generates and stores tokens so the callback can set cookies.
   */
  async validateOAuthUser(profile: OAuthProfile): Promise<{
    user: User;
    accessToken: string;
    refreshToken: string;
  }> {
    let user: User | undefined;

    // 1. Try to find by provider + providerId (most specific match)
    user = await this.usersStore.findByProviderId(profile.provider, profile.id);

    // 2. Fall back to email match (user may have registered locally before)
    if (!user) {
      user = await this.usersStore.findByEmail(profile.email);
      if (user) {
        // Link the OAuth account to the existing local account
        await this.usersStore.update(user.id, {
          provider: profile.provider,
          providerId: profile.id,
          avatarUrl: profile.picture || user.avatarUrl,
          isEmailVerified: true,
        });
        user = await this.usersStore.findById(user.id);
      }
    }

    // 3. Brand new user — create account
    if (!user) {
      user = await this.usersStore.create({
        email: profile.email,
        fullName: profile.fullName,
        avatarUrl: profile.picture,
        passwordHash: null,
        provider: profile.provider,
        providerId: profile.id,
        isEmailVerified: true,
        isPhoneVerified: false,
        status: 'active',
      });
    }

    if (user.status !== 'active') {
      throw new UnauthorizedException('Account is suspended or deleted');
    }

    const { accessToken, refreshToken } = await this.generateTokens(user);
    await this.redis.setSession(
      user.id,
      refreshToken,
      this.config.jwtRefreshExpiresIn,
    );
    await this.usersStore.update(user.id, {
      lastLoginAt: new Date(),
      avatarUrl: profile.picture || user.avatarUrl,
    });

    return { user, accessToken, refreshToken };
  }

  /* eslint-disable-next-line @typescript-eslint/require-await */
  private async generateTokens(
    user: User,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const basePayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    const accessToken = this.jwtService.sign({
      ...basePayload,
      token_type: 'access',
    });
    const refreshToken = this.jwtService.sign(
      {
        ...basePayload,
        token_type: 'refresh',
        jti: crypto.randomUUID(),
      },
      {
        expiresIn: this.config.jwtRefreshExpiresIn as `${number}d`,
      },
    );

    return { accessToken, refreshToken };
  }

  async refreshToken(oldRefreshToken: string) {
    if (!oldRefreshToken) {
      throw new UnauthorizedException('No refresh token provided');
    }

    try {
      // Verify token signature and expiration
      const payload = this.jwtService.verify<{
        sub: string;
        token_type?: string;
      }>(oldRefreshToken);
      if (payload.token_type !== 'refresh') {
        throw new UnauthorizedException('Invalid refresh token');
      }
      const userId = payload.sub;

      // Find user — authoritative DB read (skipCache): token rotation must never mint a new
      // pair from a stale cached role/status after suspension or demotion.
      const user = await this.usersStore.findById(userId, { skipCache: true });
      if (!user || user.status !== 'active') {
        throw new UnauthorizedException('User inactive or not found');
      }

      // Generate new tokens
      const { accessToken, refreshToken: newRefreshToken } =
        await this.generateTokens(user);

      // Atomic Compare-And-Swap (CAS) in Redis:
      // Replaces oldRefreshToken with newRefreshToken iff oldRefreshToken is still the active session.
      // Replayed tokens or concurrent requests racing on the same oldRefreshToken will fail CAS.
      const rotated = await this.redis.rotateSession(
        user.id,
        oldRefreshToken,
        newRefreshToken,
        this.config.jwtRefreshExpiresIn,
      );

      if (!rotated) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      return {
        success: true,
        message: 'Token refreshed successfully',
        data: {
          accessToken,
          refreshToken: newRefreshToken,
        },
      };
    } catch (err: unknown) {
      if (err instanceof UnauthorizedException) {
        throw err;
      }
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async revokeSessionByToken(token?: string): Promise<void> {
    if (!token) return;
    try {
      const payload = this.jwtService.verify<{
        sub?: string;
        token_type?: string;
      }>(token);
      if (!payload?.sub) return;
      if (payload.token_type !== 'refresh') {
        return; // Prevent access tokens or untyped tokens from revoking refresh sessions
      }
      // Atomic Compare-And-Delete (CAD): only deletes if the session still holds this exact token.
      // Prevents stale tokens from deleting newer rotated sessions.
      await this.redis.compareAndDeleteSession(payload.sub, token);
    } catch {
      // Ignored: Token may be expired, malformed, or forged signature
    }
  }

  async logout(
    userIdOrToken?: string,
  ): Promise<{ success: boolean; message: string }> {
    if (userIdOrToken) {
      if (userIdOrToken.includes('.')) {
        await this.revokeSessionByToken(userIdOrToken);
      } else {
        await this.redis.deleteSession(userIdOrToken);
      }
    }
    return {
      success: true,
      message: 'Logged out successfully',
    };
  }
}
