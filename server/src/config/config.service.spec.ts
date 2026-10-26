import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService as NestConfigService } from '@nestjs/config';
import { ConfigService } from './config.service';
import { ConfigModule } from './config.module';
import {
  validateEnvironment,
  ConfigurationError,
  MIN_SECRET_LENGTH,
} from './env.validation';

// ─── Production Fixture ────────────────────────────────────────────────────────

const VALID_STRONG_JWT_SECRET =
  'd8f8a1e4c2b9a7f3e1d6c8b4a2f0e9d7c5b3a1f9e7d5c3b1a9f7e5d3c1b9a7f5';
const VALID_STRONG_COOKIE_SECRET =
  '7a9b1c3d5e7f9a1b3c5d7e9f1a3b5c7d9e1f3a5b7c9d1e3f5a7b9c1d3e5f7a9b';
const VALID_PROD_DATABASE_URL =
  'postgresql://prod_user:StrongProdPassword123!@db.gramoz.com:5432/gramoz_prod';

const validProductionConfig: Record<string, string | undefined> = {
  NODE_ENV: 'production',
  PORT: '5000',
  AUTH_JWT_SECRET: VALID_STRONG_JWT_SECRET,
  COOKIE_SECRET: VALID_STRONG_COOKIE_SECRET,
  DATABASE_URL: VALID_PROD_DATABASE_URL,
  SSLCOMMERZ_STORE_ID: 'live_store_gramoz',
  SSLCOMMERZ_STORE_SECRET: 'LiveStoreSecretKey9988776655443322',
  SSLCOMMERZ_IS_SANDBOX: 'false',
};

describe('Production Configuration & Secrets Security (TASK-04)', () => {
  // ── Scenario 1: Production starts with valid configuration ─────────────────

  describe('Scenario 1: Valid Production Configuration', () => {
    it('accepts valid production configuration without errors', () => {
      expect(() => validateEnvironment(validProductionConfig)).not.toThrow();
    });

    it('exposes validated configuration through ConfigService in production', async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [ConfigModule],
      })
        .overrideProvider(NestConfigService)
        .useValue({
          get: (key: string, defaultValue?: unknown) =>
            validProductionConfig[key] ?? defaultValue,
        })
        .compile();

      const service = module.get<ConfigService>(ConfigService);

      expect(service.isProduction).toBe(true);
      expect(service.isDevelopment).toBe(false);
      expect(service.jwtSecret).toBe(VALID_STRONG_JWT_SECRET);
      expect(service.cookieSecret).toBe(VALID_STRONG_COOKIE_SECRET);
      expect(service.databaseUrl).toBe(VALID_PROD_DATABASE_URL);
    });
  });

  // ── Scenario 2: Missing JWT secret causes production startup failure ────────

  describe('Scenario 2: Missing JWT Secret', () => {
    it('rejects missing AUTH_JWT_SECRET and JWT_SECRET in production', () => {
      const config = { ...validProductionConfig };
      delete config.AUTH_JWT_SECRET;
      delete config.JWT_SECRET;

      expect(() => validateEnvironment(config)).toThrow(ConfigurationError);
      try {
        validateEnvironment(config);
      } catch (err: unknown) {
        const error = err as ConfigurationError;
        expect(error.validationErrors).toEqual(
          expect.arrayContaining([
            expect.stringContaining('AUTH_JWT_SECRET is required'),
          ]),
        );
      }
    });
  });

  // ── Scenario 3: Default JWT secret is rejected ─────────────────────────────

  describe('Scenario 3: Default JWT Secrets Rejection', () => {
    it.each([
      'secret',
      'supersecret',
      'verysecretpassword',
      'jwtsecret',
      'password',
      'changeme',
    ])('rejects known default JWT secret: "%s"', (defaultSecret) => {
      const config = {
        ...validProductionConfig,
        AUTH_JWT_SECRET: defaultSecret,
      };

      expect(() => validateEnvironment(config)).toThrow(ConfigurationError);
      try {
        validateEnvironment(config);
      } catch (err: unknown) {
        const error = err as ConfigurationError;
        expect(
          error.validationErrors.some((e) =>
            e.includes(
              'cannot use a known default, example, or placeholder secret',
            ),
          ),
        ).toBe(true);
      }
    });
  });

  // ── Scenario 4: Empty or whitespace-only JWT secret is rejected ────────────

  describe('Scenario 4: Empty or Whitespace-Only JWT Secret', () => {
    it.each(['', '   ', '\t\n'])(
      'rejects empty/whitespace JWT secret',
      (whitespaceSecret) => {
        const config = {
          ...validProductionConfig,
          AUTH_JWT_SECRET: whitespaceSecret,
        };

        expect(() => validateEnvironment(config)).toThrow(ConfigurationError);
        try {
          validateEnvironment(config);
        } catch (err: unknown) {
          const error = err as ConfigurationError;
          expect(
            error.validationErrors.some((e) =>
              e.includes('cannot be empty or whitespace-only'),
            ),
          ).toBe(true);
        }
      },
    );
  });

  // ── Scenario 5: JWT secret violating strength policy is rejected ───────────

  describe('Scenario 5: JWT Secret Strength Policy', () => {
    it(`rejects secret shorter than ${MIN_SECRET_LENGTH} characters`, () => {
      const shortSecret = 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5'; // 30 characters
      expect(shortSecret.length).toBeLessThan(MIN_SECRET_LENGTH);

      const config = {
        ...validProductionConfig,
        AUTH_JWT_SECRET: shortSecret,
      };

      expect(() => validateEnvironment(config)).toThrow(ConfigurationError);
      try {
        validateEnvironment(config);
      } catch (err: unknown) {
        const error = err as ConfigurationError;
        expect(
          error.validationErrors.some((e) =>
            e.includes(`must be at least ${MIN_SECRET_LENGTH} characters long`),
          ),
        ).toBe(true);
      }
    });

    it('rejects secret with insufficient character diversity (repeated chars)', () => {
      const lowEntropySecret = 'a'.repeat(32); // 32 characters, but all 'a'

      const config = {
        ...validProductionConfig,
        AUTH_JWT_SECRET: lowEntropySecret,
      };

      expect(() => validateEnvironment(config)).toThrow(ConfigurationError);
      try {
        validateEnvironment(config);
      } catch (err: unknown) {
        const error = err as ConfigurationError;
        expect(
          error.validationErrors.some((e) =>
            e.includes('insufficient entropy (repeated characters)'),
          ),
        ).toBe(true);
      }
    });
  });

  // ── Scenario 6: Missing DATABASE_URL is rejected ───────────────────────────

  describe('Scenario 6: Missing Database Configuration', () => {
    it('rejects production startup when both DATABASE_URL and DB credentials are missing', () => {
      const config = { ...validProductionConfig };
      delete config.DATABASE_URL;
      delete config.DB_HOST;
      delete config.DB_NAME;
      delete config.DB_USER;

      expect(() => validateEnvironment(config)).toThrow(ConfigurationError);
      try {
        validateEnvironment(config);
      } catch (err: unknown) {
        const error = err as ConfigurationError;
        expect(
          error.validationErrors.some((e) =>
            e.includes(
              'DATABASE_URL or complete database connection parameters',
            ),
          ),
        ).toBe(true);
      }
    });
  });

  // ── Scenario 7: Invalid database configuration is handled appropriately ───

  describe('Scenario 7: Invalid Database Configuration', () => {
    it('rejects non-postgres protocol schemes in DATABASE_URL', () => {
      const config = {
        ...validProductionConfig,
        DATABASE_URL: 'mysql://user:pass@localhost:3306/db',
      };

      expect(() => validateEnvironment(config)).toThrow(ConfigurationError);
      try {
        validateEnvironment(config);
      } catch (err: unknown) {
        const error = err as ConfigurationError;
        expect(
          error.validationErrors.some((e) =>
            e.includes('must use postgres: or postgresql: protocol scheme'),
          ),
        ).toBe(true);
      }
    });

    it('rejects malformed DATABASE_URL string', () => {
      const config = {
        ...validProductionConfig,
        DATABASE_URL: 'not-a-valid-url-format',
      };

      expect(() => validateEnvironment(config)).toThrow(ConfigurationError);
      try {
        validateEnvironment(config);
      } catch (err: unknown) {
        const error = err as ConfigurationError;
        expect(
          error.validationErrors.some((e) =>
            e.includes('must be a valid connection URL format'),
          ),
        ).toBe(true);
      }
    });

    it('rejects DATABASE_URL containing known default development password', () => {
      const config = {
        ...validProductionConfig,
        DATABASE_URL:
          'postgresql://platform_user:platform_pass@localhost:5433/platform_db',
      };

      expect(() => validateEnvironment(config)).toThrow(ConfigurationError);
      try {
        validateEnvironment(config);
      } catch (err: unknown) {
        const error = err as ConfigurationError;
        expect(
          error.validationErrors.some((e) =>
            e.includes('contains a known default development password'),
          ),
        ).toBe(true);
      }
    });

    it('rejects default DB_PASSWORD when discrete host/user are specified in production', () => {
      const config = { ...validProductionConfig };
      delete config.DATABASE_URL;
      config.DB_HOST = 'db.internal.gramoz.com';
      config.DB_NAME = 'gramoz_prod';
      config.DB_USER = 'gramoz_user';
      config.DB_PASSWORD = 'platform_pass'; // default password!

      expect(() => validateEnvironment(config)).toThrow(ConfigurationError);
      try {
        validateEnvironment(config);
      } catch (err: unknown) {
        const error = err as ConfigurationError;
        expect(
          error.validationErrors.some((e) =>
            e.includes('DB_PASSWORD cannot be a known default password'),
          ),
        ).toBe(true);
      }
    });
  });

  // ── Scenario 8: Missing required payment credentials are rejected ──────────

  describe('Scenario 8: Missing Payment Credentials', () => {
    it('rejects production config when SSLCOMMERZ_STORE_ID is set but SECRET is missing', () => {
      const config: Record<string, string | undefined> = {
        ...validProductionConfig,
        SSLCOMMERZ_STORE_ID: 'live_store_123',
      };
      delete config.SSLCOMMERZ_STORE_SECRET;

      expect(() => validateEnvironment(config)).toThrow(ConfigurationError);
      try {
        validateEnvironment(config);
      } catch (err: unknown) {
        const error = err as ConfigurationError;
        expect(
          error.validationErrors.some((e) =>
            e.includes('SSLCOMMERZ_STORE_SECRET is required'),
          ),
        ).toBe(true);
      }
    });

    it('rejects production config when SSLCOMMERZ_STORE_SECRET is set but STORE_ID is missing', () => {
      const config: Record<string, string | undefined> = {
        ...validProductionConfig,
        SSLCOMMERZ_STORE_SECRET: 'live_secret_456',
      };
      delete config.SSLCOMMERZ_STORE_ID;

      expect(() => validateEnvironment(config)).toThrow(ConfigurationError);
      try {
        validateEnvironment(config);
      } catch (err: unknown) {
        const error = err as ConfigurationError;
        expect(
          error.validationErrors.some((e) =>
            e.includes('SSLCOMMERZ_STORE_ID is required'),
          ),
        ).toBe(true);
      }
    });
  });

  // ── Scenario 9: Default payment gateway credentials are rejected ───────────

  describe('Scenario 9: Default Payment Gateway Credentials Rejection', () => {
    it('rejects development default "testbox" and "testpass" in production', () => {
      const config = {
        ...validProductionConfig,
        SSLCOMMERZ_STORE_ID: 'testbox',
        SSLCOMMERZ_STORE_SECRET: 'testpass',
      };

      expect(() => validateEnvironment(config)).toThrow(ConfigurationError);
      try {
        validateEnvironment(config);
      } catch (err: unknown) {
        const error = err as ConfigurationError;
        expect(
          error.validationErrors.some((e) =>
            e.includes('cannot use development default "testbox"'),
          ),
        ).toBe(true);
        expect(
          error.validationErrors.some((e) =>
            e.includes('cannot use development default "testpass"'),
          ),
        ).toBe(true);
      }
    });
  });

  // ── Scenario 10: Development environment supports permitted local config ──

  describe('Scenario 10: Development Environment Permitted Configuration', () => {
    it('allows default development secrets when NODE_ENV is development or unset', () => {
      const devConfig = {
        NODE_ENV: 'development',
        AUTH_JWT_SECRET: 'secret',
        COOKIE_SECRET: 'cookie-secret',
        DB_PASSWORD: 'platform_pass',
        SSLCOMMERZ_STORE_ID: 'testbox',
        SSLCOMMERZ_STORE_SECRET: 'testpass',
      };

      expect(() => validateEnvironment(devConfig)).not.toThrow();
    });

    it('defaults NODE_ENV to development when omitted and permits local dev', () => {
      const emptyConfig = {};
      expect(() => validateEnvironment(emptyConfig)).not.toThrow();
    });
  });

  // ── Scenario 11: Test environment remains deterministic ────────────────────

  describe('Scenario 11: Test Environment Determinism', () => {
    it('allows deterministic test fixtures when NODE_ENV is "test"', () => {
      const testConfig = {
        NODE_ENV: 'test',
        AUTH_JWT_SECRET: 'test-secret',
        COOKIE_SECRET: 'test-cookie-secret',
      };

      expect(() => validateEnvironment(testConfig)).not.toThrow();
    });
  });

  // ── Scenario 12: Production config does not silently fall back ─────────────

  describe('Scenario 12: No Silent Fallback to Insecure Defaults', () => {
    it('ConfigService getters do not return hardcoded secrets when in production', async () => {
      const mockNestConfig = {
        get: jest.fn((key: string, defaultValue?: unknown) => {
          if (key === 'NODE_ENV') return 'production';
          // Simulate missing secrets in environment
          return defaultValue;
        }),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ConfigService,
          { provide: NestConfigService, useValue: mockNestConfig },
        ],
      }).compile();

      const service = module.get<ConfigService>(ConfigService);

      expect(service.isProduction).toBe(true);
      // In production mode, getters MUST NOT fall back to 'secret', 'cookie-secret', or 'platform_pass'
      expect(service.jwtSecret).not.toBe('secret');
      expect(service.jwtSecret).toBe('');
      expect(service.cookieSecret).not.toBe('cookie-secret');
      expect(service.cookieSecret).toBe('');
      expect(service.dbPassword).not.toBe('platform_pass');
      expect(service.dbPassword).toBe('');
      expect(service.sslcommerzStoreId).not.toBe('testbox');
      expect(service.sslcommerzStoreId).toBe('');
    });
  });

  // ── Scenario 13: Error logs never expose actual secret values ──────────────

  describe('Scenario 13: Redaction & Diagnostic Safety in Error Messages', () => {
    it('never includes the actual sensitive secret value in validation errors', () => {
      const sensitiveAttemptedSecret = 'short-secret-leaked';

      const config = {
        ...validProductionConfig,
        AUTH_JWT_SECRET: sensitiveAttemptedSecret, // Length 19 < 32 so it fails
      };

      try {
        validateEnvironment(config);
        fail('Expected validation to throw');
      } catch (err: unknown) {
        const error = err as ConfigurationError;
        // Verify the sensitive string is NEVER in message or error list
        expect(error.message).not.toContain(sensitiveAttemptedSecret);
        for (const errText of error.validationErrors) {
          expect(errText).not.toContain(sensitiveAttemptedSecret);
        }
        // Verify it still identifies the variable name
        expect(error.message).toContain('AUTH_JWT_SECRET');
      }
    });

    it('rejects COOKIE_SECRET matching AUTH_JWT_SECRET without printing either value', () => {
      const sharedSecret = VALID_STRONG_JWT_SECRET;

      const config = {
        ...validProductionConfig,
        AUTH_JWT_SECRET: sharedSecret,
        COOKIE_SECRET: sharedSecret, // Violation: must not match!
      };

      try {
        validateEnvironment(config);
        fail('Expected validation to throw');
      } catch (err: unknown) {
        const error = err as ConfigurationError;
        expect(error.message).not.toContain(sharedSecret);
        expect(
          error.validationErrors.some((e) =>
            e.includes('COOKIE_SECRET must not match AUTH_JWT_SECRET'),
          ),
        ).toBe(true);
      }
    });
  });

  // ── Scenario 14: Application bootstrap fails before accepting HTTP requests ─

  describe('Scenario 14: Fatal Boot Before Accepting Requests', () => {
    it('throws ConfigurationError on ConfigModule initialization in invalid production environment', () => {
      const invalidProductionProcessEnv: Record<string, unknown> = {
        NODE_ENV: 'production',
        // Omitted all required secrets!
      };

      expect(() => {
        validateEnvironment(invalidProductionProcessEnv);
      }).toThrow(ConfigurationError);
    });

    it('assertProductionSecrets() throws on invalid production environment', () => {
      const originalEnv = process.env;
      try {
        process.env = {
          ...originalEnv,
          NODE_ENV: 'production',
          AUTH_JWT_SECRET: 'secret', // invalid default
        };

        const mockNestConfig = {
          get: (key: string, defaultValue?: unknown) =>
            process.env[key] ?? defaultValue,
        };
        const configService = new ConfigService(
          mockNestConfig as unknown as NestConfigService,
        );

        expect(() => {
          configService.assertProductionSecrets();
        }).toThrow(ConfigurationError);
      } finally {
        process.env = originalEnv;
      }
    });
  });
});
