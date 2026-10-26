import { Module, Global, Logger } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';
import { ConfigModule } from '@config/config.module';
import { ConfigService } from '@config/config.service';

export const DATABASE = Symbol('DATABASE');

const dbLogger = new Logger('DatabasePool');

const databaseProvider = {
  provide: DATABASE,
  inject: [ConfigService],
  useFactory: (config: ConfigService) => {
    const poolConfig = config.databaseUrl
      ? {
          connectionString: config.databaseUrl,
          max: config.dbPoolMax,
          min: config.dbPoolMin,
          idleTimeoutMillis: 30_000,
          connectionTimeoutMillis: 5_000,
        }
      : {
          host: config.dbHost,
          port: config.dbPort,
          database: config.dbName,
          user: config.dbUser,
          password: config.dbPassword,
          max: config.dbPoolMax,
          min: config.dbPoolMin,
          idleTimeoutMillis: 30_000,
          connectionTimeoutMillis: 5_000,
        };

    const pool = new Pool(poolConfig);

    // ── Error guard ──────────────────────────────────────────────────────
    // Without this handler, an unexpected error on an idle client emits an
    // uncaught 'error' event and crashes the Node.js process.
    pool.on('error', (err: Error) => {
      dbLogger.error(
        'Unexpected idle client error — pool connection lost',
        err.stack,
      );
    });

    pool.on('connect', () => {
      dbLogger.verbose('New DB client connected to pool');
    });

    dbLogger.log(
      `Database pool initialised (max=${config.dbPoolMax}, min=${config.dbPoolMin})`,
    );

    return drizzle(pool, { schema });
  },
};

@Global()
@Module({
  imports: [ConfigModule],
  providers: [databaseProvider],
  exports: [DATABASE],
})
export class DatabaseModule {}
