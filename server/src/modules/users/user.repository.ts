import { Inject, Injectable } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE } from '@database/database.module';
import * as schema from '@database/schema';
import { NewUser, User } from '@database/schema';

@Injectable()
export class UserRepository {
  constructor(
    @Inject(DATABASE)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async findAll(): Promise<User[]> {
    return this.db.select().from(schema.users);
  }

  async findById(id: string): Promise<User | undefined> {
    const [user] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, id));
    return user;
  }

  async findByEmail(email: string): Promise<User | undefined> {
    const [user] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email));
    return user;
  }

  async findByProviderId(
    provider: string,
    providerId: string,
  ): Promise<User | undefined> {
    const [user] = await this.db
      .select()
      .from(schema.users)
      .where(
        and(
          eq(schema.users.provider, provider),
          eq(schema.users.providerId, providerId),
        ),
      );
    return user;
  }

  async create(data: NewUser): Promise<User> {
    const [user] = await this.db.insert(schema.users).values(data).returning();
    return user;
  }

  async update(id: string, data: Partial<NewUser>): Promise<User | undefined> {
    const [user] = await this.db
      .update(schema.users)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.users.id, id))
      .returning();
    return user;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(schema.users).where(eq(schema.users.id, id));
  }

  async softDelete(id: string): Promise<User | undefined> {
    const [user] = await this.db
      .update(schema.users)
      .set({ deletedAt: new Date(), status: 'deleted' })
      .where(eq(schema.users.id, id))
      .returning();
    return user;
  }
}
