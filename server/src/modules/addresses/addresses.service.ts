import { Injectable } from '@nestjs/common';
import {
  EntityNotFoundError,
  InvalidOperationError,
} from '../../common/errors/domain.errors';
import * as schema from '@database/schema';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
import { AddressesStore } from './addresses.store';

@Injectable()
export class AddressesService {
  constructor(private readonly addressesStore: AddressesStore) {}

  async create(
    userId: string,
    createAddressDto: CreateAddressDto,
  ): Promise<schema.Address> {
    return await this.addressesStore.runTransaction(async (tx) => {
      // If setting as default, unset others first
      if (createAddressDto.isDefault) {
        await this.addressesStore.unsetDefaultByUserId(userId, tx);
      }

      // If this is the user's first address, force it to be default
      const hasAddresses = await this.addressesStore.checkHasAddresses(
        userId,
        tx,
      );

      const isDefault = !hasAddresses
        ? true
        : createAddressDto.isDefault || false;

      const newAddress = await this.addressesStore.createAddress(
        {
          ...createAddressDto,
          userId,
          isDefault,
        },
        tx,
      );

      return newAddress;
    });
  }

  async findAll(userId: string): Promise<schema.Address[]> {
    return await this.addressesStore.findAllByUserId(userId);
  }

  async findOne(id: string, userId: string): Promise<schema.Address> {
    const address = await this.addressesStore.findOneByIdAndUserId(id, userId);

    if (!address) {
      throw new EntityNotFoundError('Address not found');
    }

    return address;
  }

  async update(
    id: string,
    userId: string,
    updateAddressDto: UpdateAddressDto,
  ): Promise<schema.Address> {
    await this.findOne(id, userId); // Ensure it exists and belongs to user

    return await this.addressesStore.runTransaction(async (tx) => {
      if (updateAddressDto.isDefault) {
        await this.addressesStore.unsetDefaultByUserId(userId, tx);
      }

      const updatedAddress = await this.addressesStore.updateAddress(
        id,
        userId,
        updateAddressDto,
        tx,
      );

      return updatedAddress;
    });
  }

  async remove(id: string, userId: string): Promise<void> {
    const address = await this.findOne(id, userId);

    try {
      await this.addressesStore.runTransaction(async (tx) => {
        await this.addressesStore.removeAddress(id, userId, tx);

        // If the deleted address was default, make another one default if any exist
        if (address.isDefault) {
          const nextAddressId =
            await this.addressesStore.getFirstAddressIdByUserId(userId, tx);

          if (nextAddressId) {
            await this.addressesStore.setAddressAsDefault(nextAddressId, tx);
          }
        }
      });
    } catch (error: any) {
      if (
        error.code === '23503' ||
        error.message?.includes('foreign key constraint')
      ) {
        throw new InvalidOperationError(
          'Cannot delete this address because it is associated with past orders.',
        );
      }
      throw error;
    }
  }

  async setDefault(id: string, userId: string): Promise<schema.Address> {
    await this.findOne(id, userId);

    return await this.addressesStore.runTransaction(async (tx) => {
      await this.addressesStore.unsetDefaultByUserId(userId, tx);

      const updatedAddress = await this.addressesStore.setAddressAsDefault(
        id,
        tx,
      );

      return updatedAddress;
    });
  }
}
