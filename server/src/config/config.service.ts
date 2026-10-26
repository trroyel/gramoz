import { Injectable } from '@nestjs/common';
import { ConfigService as NestConfigService } from '@nestjs/config';
import { validateEnvironment } from './env.validation';

@Injectable()
export class ConfigService {
  constructor(private readonly configService: NestConfigService) {}

  // Environment Helpers
  get nodeEnv(): string {
    return this.configService.get<string>('NODE_ENV', 'development');
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  get isDevelopment(): boolean {
    return this.nodeEnv === 'development';
  }

  get isTest(): boolean {
    return this.nodeEnv === 'test';
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
    return this.configService.get<string>(
      'DB_PASSWORD',
      this.isProduction ? '' : 'platform_pass',
    );
  }

  get databaseUrl(): string {
    return this.configService.get<string>('DATABASE_URL', '');
  }

  get dbPoolMax(): number {
    return this.configService.get<number>('DB_POOL_MAX', 20);
  }

  get dbPoolMin(): number {
    return this.configService.get<number>('DB_POOL_MIN', 2);
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

  get redisUrl(): string {
    return this.configService.get<string>('REDIS_URL', '');
  }

  // Email
  get emailApiKey(): string {
    return this.configService.get<string>('EMAIL_API_KEY', '');
  }

  get emailFrom(): string {
    return this.configService.get<string>('EMAIL_FROM', 'noreply@gramoz.com');
  }

  get adminEmail(): string {
    return this.configService.get<string>('ADMIN_EMAIL', '');
  }

  // Auth & Secrets
  get jwtSecret(): string {
    return (
      this.configService.get<string>('AUTH_JWT_SECRET') ||
      this.configService.get<string>('JWT_SECRET') ||
      (this.isProduction ? '' : 'secret')
    );
  }

  get cookieSecret(): string {
    return this.configService.get<string>(
      'COOKIE_SECRET',
      this.isProduction ? '' : 'cookie-secret',
    );
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

  // Payment Gateway (SSLCommerz)
  get sslcommerzStoreId(): string {
    return this.configService.get<string>(
      'SSLCOMMERZ_STORE_ID',
      this.isProduction ? '' : 'testbox',
    );
  }

  get sslcommerzStoreSecret(): string {
    return this.configService.get<string>(
      'SSLCOMMERZ_STORE_SECRET',
      this.isProduction ? '' : 'testpass',
    );
  }

  get sslcommerzIsSandbox(): boolean {
    return this.configService.get<string>('SSLCOMMERZ_IS_SANDBOX') !== 'false';
  }

  // Google OAuth
  get googleClientId(): string {
    return this.configService.get<string>('OAUTH_CLIENT_ID', '');
  }

  get googleClientSecret(): string {
    return this.configService.get<string>('OAUTH_CLIENT_SECRET', '');
  }

  get googleCallbackUrl(): string {
    return this.configService.get<string>(
      'OAUTH_CALLBACK_URL',
      'http://localhost:5000/api/v1/auth/google/callback',
    );
  }

  get frontendUrl(): string {
    return this.configService.get<string>(
      'FRONTEND_URL',
      'http://localhost:3000',
    );
  }

  // Facebook OAuth
  get facebookAppId(): string {
    return this.configService.get<string>('FB_APP_ID', '');
  }

  get facebookAppSecret(): string {
    return this.configService.get<string>('FB_APP_SECRET', '');
  }

  get facebookCallbackUrl(): string {
    return this.configService.get<string>(
      'FB_CALLBACK_URL',
      'http://localhost:5000/api/v1/auth/facebook/callback',
    );
  }

  // SMS Token
  get gwSmsToken(): string {
    return this.configService.get<string>('GW_SMS_TOKEN', '');
  }

  /**
   * Programmatic assertion of production secrets.
   * Throws ConfigurationError if production secrets policy is violated.
   */
  assertProductionSecrets(): void {
    validateEnvironment(process.env);
  }
}
