import { Injectable, Inject } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and } from 'drizzle-orm';
import * as schema from '@database/schema';
import { DATABASE } from '@database/database.module';

@Injectable()
export class AddressesStore {
  constructor(
    @Inject(DATABASE) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async unsetDefaultByUserId(userId: string, tx?: any) {
    const executor = tx || this.db;
    return await executor
      .update(schema.addresses)
      .set({ isDefault: false })
      .where(eq(schema.addresses.userId, userId))
      .returning();
  }

  async checkHasAddresses(userId: string, tx?: any): Promise<boolean> {
    const executor = tx || this.db;
    const existingAddresses = await executor
      .select({ id: schema.addresses.id })
      .from(schema.addresses)
      .where(eq(schema.addresses.userId, userId))
      .limit(1);
    
    return existingAddresses.length > 0;
  }

  async createAddress(data: typeof schema.addresses.$inferInsert, tx?: any): Promise<schema.Address> {
    const executor = tx || this.db;
    const [newAddress] = await executor
      .insert(schema.addresses)
      .values(data)
      .returning();

    return newAddress;
  }

  async findAllByUserId(userId: string, tx?: any): Promise<schema.Address[]> {
    const executor = tx || this.db;
    return await executor
      .select()
      .from(schema.addresses)
      .where(eq(schema.addresses.userId, userId))
      .orderBy(schema.addresses.createdAt);
  }

  async findOneByIdAndUserId(id: string, userId: string, tx?: any): Promise<schema.Address | null> {
    const executor = tx || this.db;
    const [address] = await executor
      .select()
      .from(schema.addresses)
      .where(
        and(eq(schema.addresses.id, id), eq(schema.addresses.userId, userId)),
      );

    return address || null;
  }

  async updateAddress(id: string, userId: string, data: Partial<typeof schema.addresses.$inferInsert>, tx?: any): Promise<schema.Address> {
    const executor = tx || this.db;
    const [updatedAddress] = await executor
      .update(schema.addresses)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(
        and(eq(schema.addresses.id, id), eq(schema.addresses.userId, userId)),
      )
      .returning();

    return updatedAddress;
  }

  async removeAddress(id: string, userId: string, tx?: any): Promise<void> {
    const executor = tx || this.db;
    await executor
      .delete(schema.addresses)
      .where(
        and(eq(schema.addresses.id, id), eq(schema.addresses.userId, userId)),
      )
      .returning();
  }

  async getFirstAddressIdByUserId(userId: string, tx?: any): Promise<string | null> {
    const executor = tx || this.db;
    const [address] = await executor
      .select({ id: schema.addresses.id })
      .from(schema.addresses)
      .where(eq(schema.addresses.userId, userId))
      .limit(1);

    return address?.id || null;
  }

  async setAddressAsDefault(id: string, tx?: any): Promise<schema.Address> {
    const executor = tx || this.db;
    const [updatedAddress] = await executor
      .update(schema.addresses)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(eq(schema.addresses.id, id))
      .returning();

    return updatedAddress;
  }

  async runTransaction<T>(cb: (tx: any) => Promise<T>): Promise<T> {
    return await this.db.transaction(cb);
  }
}
