import { Module, Global } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export const DATABASE = Symbol('DATABASE');

const databaseProvider = {
  provide: DATABASE,
  useFactory: () => {
    const pool = new Pool({
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
    });

    return drizzle(pool, { schema });
  },
};

@Global()
@Module({
  providers: [databaseProvider],
  exports: [DATABASE],
})
export class DatabaseModule {}
