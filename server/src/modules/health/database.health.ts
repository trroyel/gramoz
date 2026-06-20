import { Injectable } from '@nestjs/common';
import {
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { Inject } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { DATABASE } from '@database/database.module';
import * as schema from '@database/schema';

@Injectable()
export class DatabaseHealthIndicator {
  constructor(
    @Inject(DATABASE) private readonly db: NodePgDatabase<typeof schema>,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);
    try {
      await this.db.execute(sql`SELECT 1`);
      return indicator.up();
    } catch (error) {
      return indicator.down({ error: (error as Error).message });
    }
  }
}
