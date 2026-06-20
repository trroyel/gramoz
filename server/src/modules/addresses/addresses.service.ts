import { Injectable, Inject } from '@nestjs/common';
import { EntityNotFoundError } from '../../common/errors/domain.errors';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and } from 'drizzle-orm';
import * as schema from '@database/schema';
import { DATABASE } from '@database/database.module';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';

@Injectable()
export class AddressesService {
  constructor(
    @Inject(DATABASE) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async create(userId: string, createAddressDto: CreateAddressDto): Promise<schema.Address> {
    return await this.db.transaction(async (tx) => {
      // If setting as default, unset others first
      if (createAddressDto.isDefault) {
        await tx
          .update(schema.addresses)
          .set({ isDefault: false })
          .where(eq(schema.addresses.userId, userId))
          .returning();
      }

      // If this is the user's first address, force it to be default
      const existingAddresses = await tx
        .select({ id: schema.addresses.id })
        .from(schema.addresses)
        .where(eq(schema.addresses.userId, userId))
        .limit(1);

      const isFirstAddress = existingAddresses.length === 0;
      const isDefault = isFirstAddress
        ? true
        : createAddressDto.isDefault || false;

      const [newAddress] = await tx
        .insert(schema.addresses)
        .values({
          ...createAddressDto,
          userId,
          isDefault,
        })
        .returning();

      return newAddress;
    });
  }

  async findAll(userId: string): Promise<schema.Address[]> {
    return await this.db
      .select()
      .from(schema.addresses)
      .where(eq(schema.addresses.userId, userId))
      .orderBy(schema.addresses.createdAt);
  }

  async findOne(id: string, userId: string): Promise<schema.Address> {
    const [address] = await this.db
      .select()
      .from(schema.addresses)
      .where(
        and(eq(schema.addresses.id, id), eq(schema.addresses.userId, userId)),
      );

    if (!address) {
      throw new EntityNotFoundError('Address not found');
    }

    return address;
  }

  async update(id: string, userId: string, updateAddressDto: UpdateAddressDto): Promise<schema.Address> {
    await this.findOne(id, userId); // Ensure it exists and belongs to user

    return await this.db.transaction(async (tx) => {
      if (updateAddressDto.isDefault) {
        await tx
          .update(schema.addresses)
          .set({ isDefault: false })
          .where(eq(schema.addresses.userId, userId))
          .returning();
      }

      const [updatedAddress] = await tx
        .update(schema.addresses)
        .set({
          ...updateAddressDto,
          updatedAt: new Date(),
        })
        .where(
          and(eq(schema.addresses.id, id), eq(schema.addresses.userId, userId)),
        )
        .returning();

      return updatedAddress;
    });
  }

  async remove(id: string, userId: string): Promise<void> {
    const address = await this.findOne(id, userId);

    await this.db.transaction(async (tx) => {
      await tx
        .delete(schema.addresses)
        .where(
          and(eq(schema.addresses.id, id), eq(schema.addresses.userId, userId)),
        )
        .returning();

      // If the deleted address was default, make another one default if any exist
      if (address.isDefault) {
        const [nextAddress] = await tx
          .select({ id: schema.addresses.id })
          .from(schema.addresses)
          .where(eq(schema.addresses.userId, userId))
          .limit(1);

        if (nextAddress) {
          await tx
            .update(schema.addresses)
            .set({ isDefault: true })
            .where(eq(schema.addresses.id, nextAddress.id))
            .returning();
        }
      }
    });
  }

  async setDefault(id: string, userId: string): Promise<schema.Address> {
    await this.findOne(id, userId);

    return await this.db.transaction(async (tx) => {
      await tx
        .update(schema.addresses)
        .set({ isDefault: false })
        .where(eq(schema.addresses.userId, userId))
        .returning();

      const [updatedAddress] = await tx
        .update(schema.addresses)
        .set({ isDefault: true, updatedAt: new Date() })
        .where(
          and(eq(schema.addresses.id, id), eq(schema.addresses.userId, userId)),
        )
        .returning();

      return updatedAddress;
    });
  }
}
