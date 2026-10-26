import { Injectable, Inject } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { DATABASE } from '@database/database.module';
import * as schema from '@database/schema';

@Injectable()
export class SettingsStore {
  constructor(
    @Inject(DATABASE) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async getSetting(key: string): Promise<string | null> {
    const [setting] = await this.db
      .select({ value: schema.settings.value })
      .from(schema.settings)
      .where(eq(schema.settings.key, key));
    return setting?.value || null;
  }

  async setSetting(
    key: string,
    value: string,
    description?: string,
  ): Promise<void> {
    await this.db
      .insert(schema.settings)
      .values({ key, value, description })
      .onConflictDoUpdate({
        target: schema.settings.key,
        set: { value, description, updatedAt: new Date() },
      });
  }

  async getAllSettings(): Promise<schema.Setting[]> {
    return this.db.select().from(schema.settings);
  }
}
