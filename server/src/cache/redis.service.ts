import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { ConfigService } from '@config/config.service';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis;

  constructor(private readonly config: ConfigService) {
    this.client = new Redis({
      host: this.config.redisHost,
      port: this.config.redisPort,
      password: this.config.redisPassword,
    });
  }

  onModuleDestroy() {
    this.client.disconnect();
  }

  // Session management
  async setSession(
    userId: string,
    token: string,
    expiresIn: string,
  ): Promise<void> {
    const ttl = this.parseDuration(expiresIn);
    await this.client.setex(`auth:session:${userId}`, ttl, token);
  }

  async getSession(userId: string): Promise<string | null> {
    return this.client.get(`auth:session:${userId}`);
  }

  async deleteSession(userId: string): Promise<void> {
    await this.client.del(`auth:session:${userId}`);
  }

  // Email verification code
  async setVerificationCode(
    email: string,
    code: string,
    expiresIn: string,
  ): Promise<void> {
    const ttl = this.parseDuration(expiresIn);
    await this.client.setex(`auth:verify:${email}`, ttl, code);
  }

  async getVerificationCode(email: string): Promise<string | null> {
    return this.client.get(`auth:verify:${email}`);
  }

  async deleteVerificationCode(email: string): Promise<void> {
    await this.client.del(`auth:verify:${email}`);
  }

  // Password reset code
  async setResetCode(
    email: string,
    code: string,
    expiresIn: string,
  ): Promise<void> {
    const ttl = this.parseDuration(expiresIn);
    await this.client.setex(`auth:reset:${email}`, ttl, code);
  }

  async getResetCode(email: string): Promise<string | null> {
    return this.client.get(`auth:reset:${email}`);
  }

  async deleteResetCode(email: string): Promise<void> {
    await this.client.del(`auth:reset:${email}`);
  }

  // Generate 8-digit code
  generateCode(): string {
    return Math.floor(10000000 + Math.random() * 90000000).toString();
  }

  // Parse duration string to seconds (e.g., "15m" -> 900, "7d" -> 604800)
  private parseDuration(duration: string): number {
    const unit = duration.slice(-1);
    const value = parseInt(duration.slice(0, -1));

    switch (unit) {
      case 's':
        return value;
      case 'm':
        return value * 60;
      case 'h':
        return value * 60 * 60;
      case 'd':
        return value * 24 * 60 * 60;
      default:
        return 900; // default 15 minutes
    }
  }
}
