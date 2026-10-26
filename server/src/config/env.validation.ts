export const MIN_SECRET_LENGTH = 32;

export const DISALLOWED_DEFAULT_SECRETS = new Set([
  'secret',
  'supersecret',
  'verysecretpassword',
  'cookie-secret',
  'testpass',
  'testbox',
  'platform_pass',
  'postgres_admin_pass',
  'redis_pass',
  'changeme',
  'password',
  '12345678',
  'admin',
  'jwtsecret',
  'mysecretkey',
  'default',
  'test',
]);

export class ConfigurationError extends Error {
  public readonly validationErrors: string[];

  constructor(errors: string[]) {
    const formatted = errors.map((e) => `  - ${e}`).join('\n');
    super(
      `Configuration validation failed with ${errors.length} error(s):\n${formatted}`,
    );
    this.name = 'ConfigurationError';
    this.validationErrors = errors;
  }
}

/**
 * Validates the application environment configuration.
 * In production (NODE_ENV=production), strict fail-closed checks are enforced
 * against missing, empty, default, or weak secrets.
 * In development and test environments, safe defaults are permitted.
 *
 * Diagnostic messages NEVER expose actual secret values.
 */
export function validateEnvironment(
  rawEnv: Record<string, unknown>,
): Record<string, unknown> {
  const env = { ...rawEnv };
  const errors: string[] = [];

  const nodeEnv =
    (typeof env.NODE_ENV === 'string' ? env.NODE_ENV.trim() : '') ||
    'development';
  const isProduction = nodeEnv === 'production';

  // 1. Validate NODE_ENV
  if (env.NODE_ENV !== undefined) {
    const validEnvironments = ['development', 'production', 'test'];
    if (!validEnvironments.includes(nodeEnv)) {
      const rawVal =
        typeof env.NODE_ENV === 'string'
          ? env.NODE_ENV
          : JSON.stringify(env.NODE_ENV);
      errors.push(
        `NODE_ENV must be one of: ${validEnvironments.join(', ')} (received '${rawVal}')`,
      );
    }
  }

  // 2. Validate PORT
  if (env.PORT !== undefined && env.PORT !== '') {
    const port = Number(env.PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      errors.push('PORT must be an integer between 1 and 65535.');
    }
  }

  // 3. Validate AUTH_JWT_SECRET / JWT_SECRET
  const jwtSecretRaw = env.AUTH_JWT_SECRET ?? env.JWT_SECRET;
  validateJwtSecret(jwtSecretRaw, isProduction, errors);

  // 4. Validate COOKIE_SECRET
  const cookieSecretRaw = env.COOKIE_SECRET;
  validateCookieSecret(cookieSecretRaw, jwtSecretRaw, isProduction, errors);

  // 5. Validate Database Configuration
  validateDatabaseConfig(env, isProduction, errors);

  // 6. Validate Payment Gateway Credentials (SSLCommerz)
  validatePaymentGateway(env, isProduction, errors);

  if (errors.length > 0) {
    throw new ConfigurationError(errors);
  }

  return env;
}

function validateJwtSecret(
  secret: unknown,
  isProduction: boolean,
  errors: string[],
): void {
  const isProvided = typeof secret === 'string' && secret.trim().length > 0;

  if (!isProvided) {
    if (isProduction) {
      errors.push(
        'AUTH_JWT_SECRET is required and cannot be empty or whitespace-only in production.',
      );
    }
    return;
  }

  const trimmed = secret.trim();

  if (isProduction) {
    if (trimmed.length < MIN_SECRET_LENGTH) {
      errors.push(
        `AUTH_JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters long in production (policy: minimum 256 bits).`,
      );
    }

    if (DISALLOWED_DEFAULT_SECRETS.has(trimmed.toLowerCase())) {
      errors.push(
        'AUTH_JWT_SECRET cannot use a known default, example, or placeholder secret in production.',
      );
    }

    if (new Set(trimmed).size < 4) {
      errors.push(
        'AUTH_JWT_SECRET has insufficient entropy (repeated characters).',
      );
    }
  }
}

function validateCookieSecret(
  cookieSecret: unknown,
  jwtSecret: unknown,
  isProduction: boolean,
  errors: string[],
): void {
  const isProvided =
    typeof cookieSecret === 'string' && cookieSecret.trim().length > 0;

  if (!isProvided) {
    if (isProduction) {
      errors.push(
        'COOKIE_SECRET is required and cannot be empty or whitespace-only in production.',
      );
    }
    return;
  }

  const trimmedCookie = cookieSecret.trim();

  if (isProduction) {
    if (trimmedCookie.length < MIN_SECRET_LENGTH) {
      errors.push(
        `COOKIE_SECRET must be at least ${MIN_SECRET_LENGTH} characters long in production.`,
      );
    }

    if (DISALLOWED_DEFAULT_SECRETS.has(trimmedCookie.toLowerCase())) {
      errors.push(
        'COOKIE_SECRET cannot use a known default, example, or placeholder secret in production.',
      );
    }

    if (new Set(trimmedCookie).size < 4) {
      errors.push(
        'COOKIE_SECRET has insufficient entropy (repeated characters).',
      );
    }

    if (typeof jwtSecret === 'string' && trimmedCookie === jwtSecret.trim()) {
      errors.push(
        'COOKIE_SECRET must not match AUTH_JWT_SECRET (cryptographic key separation violation).',
      );
    }
  }
}

function validateDatabaseConfig(
  env: Record<string, unknown>,
  isProduction: boolean,
  errors: string[],
): void {
  const databaseUrl =
    typeof env.DATABASE_URL === 'string' ? env.DATABASE_URL.trim() : '';
  const dbPassword =
    typeof env.DB_PASSWORD === 'string' ? env.DB_PASSWORD.trim() : '';

  if (databaseUrl) {
    try {
      const parsed = new URL(databaseUrl);
      if (
        parsed.protocol !== 'postgres:' &&
        parsed.protocol !== 'postgresql:'
      ) {
        errors.push(
          'DATABASE_URL must use postgres: or postgresql: protocol scheme.',
        );
      }
      if (
        isProduction &&
        parsed.password &&
        DISALLOWED_DEFAULT_SECRETS.has(parsed.password.toLowerCase())
      ) {
        errors.push(
          'DATABASE_URL contains a known default development password in production.',
        );
      }
    } catch {
      errors.push('DATABASE_URL must be a valid connection URL format.');
    }
    return;
  }

  if (isProduction) {
    const hasHost =
      typeof env.DB_HOST === 'string' && env.DB_HOST.trim().length > 0;
    const hasName =
      typeof env.DB_NAME === 'string' && env.DB_NAME.trim().length > 0;
    const hasUser =
      typeof env.DB_USER === 'string' && env.DB_USER.trim().length > 0;

    if (!hasHost && !hasName && !hasUser) {
      errors.push(
        'DATABASE_URL or complete database connection parameters (DB_HOST, DB_NAME, DB_USER, DB_PASSWORD) must be provided in production.',
      );
    } else {
      if (!dbPassword) {
        errors.push(
          'DB_PASSWORD is required in production when DATABASE_URL is not provided.',
        );
      } else if (DISALLOWED_DEFAULT_SECRETS.has(dbPassword.toLowerCase())) {
        errors.push(
          'DB_PASSWORD cannot be a known default password in production.',
        );
      }
    }
  }
}

function validatePaymentGateway(
  env: Record<string, unknown>,
  isProduction: boolean,
  errors: string[],
): void {
  const storeId =
    typeof env.SSLCOMMERZ_STORE_ID === 'string'
      ? env.SSLCOMMERZ_STORE_ID.trim()
      : '';
  const storeSecret =
    typeof env.SSLCOMMERZ_STORE_SECRET === 'string'
      ? env.SSLCOMMERZ_STORE_SECRET.trim()
      : '';

  if (isProduction) {
    if (storeId || storeSecret) {
      if (!storeId) {
        errors.push(
          'SSLCOMMERZ_STORE_ID is required when SSLCommerz payment gateway is enabled.',
        );
      } else if (
        storeId.toLowerCase() === 'testbox' ||
        DISALLOWED_DEFAULT_SECRETS.has(storeId.toLowerCase())
      ) {
        errors.push(
          'SSLCOMMERZ_STORE_ID cannot use development default "testbox" in production.',
        );
      }

      if (!storeSecret) {
        errors.push(
          'SSLCOMMERZ_STORE_SECRET is required when SSLCommerz payment gateway is enabled.',
        );
      } else if (
        storeSecret.toLowerCase() === 'testpass' ||
        DISALLOWED_DEFAULT_SECRETS.has(storeSecret.toLowerCase())
      ) {
        errors.push(
          'SSLCOMMERZ_STORE_SECRET cannot use development default "testpass" in production.',
        );
      }
    }
  }
}
