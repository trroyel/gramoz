import { Injectable } from '@nestjs/common';
import { ConfigService as NestConfigService } from '@nestjs/config';

@Injectable()
export class ConfigService {
  constructor(private readonly configService: NestConfigService) {}

  // Application
  get nodeEnv(): string {
    return this.configService.get<string>('NODE_ENV', 'development');
  }

  get port(): number {
    return this.configService.get<number>('PORT', 5000);
  }

  // Database
  get dbHost(): string {
    return this.configService.get<string>('DB_HOST', 'localhost');
  }

  get dbPort(): number {
    return this.configService.get<number>('DB_PORT', 5432);
  }

  get dbName(): string {
    return this.configService.get<string>('DB_NAME', 'platform_db');
  }

  get dbUser(): string {
    return this.configService.get<string>('DB_USER', 'platform_user');
  }

  get dbPassword(): string {
    return this.configService.get<string>('DB_PASSWORD', 'platform_pass');
  }

  get databaseUrl(): string {
    return this.configService.get<string>('DATABASE_URL', '');
  }

  // Redis
  get redisHost(): string {
    return this.configService.get<string>('REDIS_HOST', 'localhost');
  }

  get redisPort(): number {
    return this.configService.get<number>('REDIS_PORT', 6379);
  }

  get redisPassword(): string {
    return this.configService.get<string>('REDIS_PASSWORD', '');
  }

  // Email
  get emailApiKey(): string {
    return this.configService.get<string>('EMAIL_API_KEY', '');
  }

  get emailFrom(): string {
    return this.configService.get<string>('EMAIL_FROM', 'noreply@gramoz.com');
  }

  // Auth
  get jwtSecret(): string {
    return this.configService.get<string>('AUTH_JWT_SECRET', 'secret');
  }

  get jwtExpiresIn(): string {
    return this.configService.get<string>('AUTH_JWT_EXPIRES_IN', '15m');
  }

  get jwtRefreshExpiresIn(): string {
    return this.configService.get<string>('AUTH_JWT_REFRESH_EXPIRES_IN', '7d');
  }

  get verifyEmailTokenExpiresIn(): string {
    return this.configService.get<string>(
      'AUTH_VERIFY_EMAIL_TOKEN_EXPIRES_IN',
      '4h',
    );
  }

  get resetPasswordTokenExpiresIn(): string {
    return this.configService.get<string>(
      'AUTH_RESET_PASSWORD_TOKEN_EXPIRES_IN',
      '1h',
    );
  }

  get bcryptSaltRounds(): number {
    return this.configService.get<number>('AUTH_BCRYPT_SALT_ROUNDS', 10);
  }
}
