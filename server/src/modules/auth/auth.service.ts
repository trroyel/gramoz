import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { ConfigService } from '@config/config.service';
import { RedisService } from '@cache/redis.service';
import { UserRepository } from '@modules/users/user.repository';
import { MailService } from './mail.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { User } from '@database/schema';

@Injectable()
export class AuthService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly jwtService: JwtService,
    private readonly redis: RedisService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    // Check if user exists
    const existingUser = await this.userRepository.findByEmail(dto.email);
    if (existingUser) {
      throw new ConflictException('Email already registered');
    }

    // Hash password
    const passwordHash = await argon2.hash(dto.password);

    // Create user
    const user = await this.userRepository.create({
      email: dto.email,
      passwordHash,
      fullName: dto.fullName,
      phone: dto.phone,
      isEmailVerified: false,
      isPhoneVerified: false,
      status: 'active',
    });

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
    const user = await this.userRepository.findByEmail(dto.email);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check password
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

    // Generate JWT token
    const token = await this.generateToken(user);

    // Store session in Redis
    await this.redis.setSession(
      user.id,
      token,
      this.config.jwtRefreshExpiresIn,
    );

    // Update last login
    await this.userRepository.update(user.id, { lastLoginAt: new Date() });

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
        token,
      },
    };
  }

  async verifyEmail(dto: VerifyEmailDto) {
    // Get stored code
    const storedCode = await this.redis.getVerificationCode(dto.email);
    if (!storedCode) {
      throw new BadRequestException('Verification code expired or invalid');
    }

    // Verify code
    if (storedCode !== dto.code) {
      throw new BadRequestException('Invalid verification code');
    }

    // Find user
    const user = await this.userRepository.findByEmail(dto.email);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Update user
    await this.userRepository.update(user.id, { isEmailVerified: true });

    // Delete verification code
    await this.redis.deleteVerificationCode(dto.email);

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
    const user = await this.userRepository.findByEmail(email);
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

  async forgotPassword(dto: ForgotPasswordDto) {
    // Find user
    const user = await this.userRepository.findByEmail(dto.email);
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

    // Verify code
    if (storedCode !== dto.code) {
      throw new BadRequestException('Invalid reset code');
    }

    // Find user
    const user = await this.userRepository.findByEmail(dto.email);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Hash new password
    const passwordHash = await argon2.hash(dto.newPassword);

    // Update password
    await this.userRepository.update(user.id, { passwordHash });

    // Delete reset code
    await this.redis.deleteResetCode(dto.email);

    // Delete session (force re-login)
    await this.redis.deleteSession(user.id);

    return {
      success: true,
      message:
        'Password reset successfully. Please login with your new password.',
      data: null,
    };
  }

  async getMe(user: User) {
    return {
      success: true,
      message: 'User profile retrieved',
      data: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        phone: user.phone,
        isEmailVerified: user.isEmailVerified,
        isPhoneVerified: user.isPhoneVerified,
        status: user.status,
        createdAt: user.createdAt,
      },
    };
  }

  private async generateToken(user: User): Promise<string> {
    const payload = {
      sub: user.id,
      email: user.email,
    };

    return this.jwtService.sign(payload);
  }
}
