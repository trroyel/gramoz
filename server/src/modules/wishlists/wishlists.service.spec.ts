/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { WishlistsService } from './wishlists.service';
import { WishlistsStore } from './wishlists.store';

describe('WishlistsService (Unit Tests — TASK-23)', () => {
  let service: WishlistsService;
  let store: jest.Mocked<WishlistsStore>;

  const validUserId = '11111111-1111-4111-8111-111111111111';
  const validProductId = '22222222-2222-4222-8222-222222222222';

  beforeEach(async () => {
    const mockStore = {
      add: jest.fn(),
      remove: jest.fn(),
      findByUser: jest.fn(),
      check: jest.fn(),
      getProductById: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WishlistsService,
        { provide: WishlistsStore, useValue: mockStore },
      ],
    }).compile();

    service = module.get<WishlistsService>(WishlistsService);
    store = module.get(WishlistsStore);
  });

  describe('add to wishlist', () => {
    it('rejects invalid product UUID format with BadRequestException', async () => {
      await expect(
        service.add(validUserId, 'invalid-uuid-format'),
      ).rejects.toThrow(BadRequestException);
      expect(store.add).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when product does not exist in catalog', async () => {
      store.getProductById.mockResolvedValue(null);

      await expect(service.add(validUserId, validProductId)).rejects.toThrow(
        NotFoundException,
      );
      expect(store.add).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when product is soft-deleted', async () => {
      store.getProductById.mockResolvedValue({
        id: validProductId,
        status: 'active',
        deletedAt: new Date(),
      } as any);

      await expect(service.add(validUserId, validProductId)).rejects.toThrow(
        NotFoundException,
      );
      expect(store.add).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when product is archived', async () => {
      store.getProductById.mockResolvedValue({
        id: validProductId,
        status: 'archived',
        deletedAt: null,
      } as any);

      await expect(service.add(validUserId, validProductId)).rejects.toThrow(
        NotFoundException,
      );
      expect(store.add).not.toHaveBeenCalled();
    });

    it('successfully adds valid active product and returns confirmation', async () => {
      store.getProductById.mockResolvedValue({
        id: validProductId,
        status: 'active',
        deletedAt: null,
      } as any);
      store.add.mockResolvedValue({
        id: 'w-1',
        userId: validUserId,
        productId: validProductId,
        createdAt: new Date(),
      } as any);

      const result = await service.add(validUserId, validProductId);
      expect(result).toEqual({ success: true, message: 'Added to wishlist' });
      expect(store.add).toHaveBeenCalledWith(validUserId, validProductId);
    });

    it('handles duplicate addition idempotently via onConflictDoNothing in store', async () => {
      store.getProductById.mockResolvedValue({
        id: validProductId,
        status: 'active',
        deletedAt: null,
      } as any);
      store.add.mockResolvedValue(undefined as any); // conflict resulted in no returned row

      const result = await service.add(validUserId, validProductId);
      expect(result).toEqual({ success: true, message: 'Added to wishlist' });
    });
  });

  describe('remove from wishlist', () => {
    it('rejects invalid product UUID format with BadRequestException', async () => {
      await expect(
        service.remove(validUserId, 'non-uuid-string'),
      ).rejects.toThrow(BadRequestException);
      expect(store.remove).not.toHaveBeenCalled();
    });

    it('safely handles removing existing product', async () => {
      store.remove.mockResolvedValue({
        id: 'w-1',
        userId: validUserId,
        productId: validProductId,
        createdAt: new Date(),
      } as any);

      const result = await service.remove(validUserId, validProductId);
      expect(result).toEqual({
        success: true,
        message: 'Removed from wishlist',
      });
      expect(store.remove).toHaveBeenCalledWith(validUserId, validProductId);
    });

    it('safely and idempotently handles removing a missing item without crashing', async () => {
      store.remove.mockResolvedValue(undefined as any);

      const result = await service.remove(validUserId, validProductId);
      expect(result).toEqual({
        success: true,
        message: 'Removed from wishlist',
      });
    });
  });

  describe('findByUser', () => {
    it('returns filtered wishlist list for user', async () => {
      const mockList = [
        {
          id: 'w-1',
          userId: validUserId,
          productId: validProductId,
          product: { id: validProductId, name: 'Saree' },
        },
      ];
      store.findByUser.mockResolvedValue(mockList as any);

      const result = await service.findByUser(validUserId);
      expect(result).toEqual(mockList);
      expect(store.findByUser).toHaveBeenCalledWith(validUserId);
    });
  });

  describe('checkStatus', () => {
    it('returns false for invalid UUID without hitting database', async () => {
      const result = await service.check(validUserId, 'not-a-uuid');
      expect(result).toEqual({ isFavorited: false });
      expect(store.check).not.toHaveBeenCalled();
    });

    it('returns isFavorited boolean from store for valid UUID', async () => {
      store.check.mockResolvedValue(true);

      const result = await service.check(validUserId, validProductId);
      expect(result).toEqual({ isFavorited: true });
      expect(store.check).toHaveBeenCalledWith(validUserId, validProductId);
    });
  });
});
