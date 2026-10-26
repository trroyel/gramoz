/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { WishlistsController } from './wishlists.controller';
import { WishlistsService } from './wishlists.service';

describe('WishlistsController (Unit Tests — TASK-23)', () => {
  let controller: WishlistsController;
  let service: jest.Mocked<WishlistsService>;

  const mockUser = { id: '11111111-1111-4111-8111-111111111111' };
  const mockProductId = '22222222-2222-4222-8222-222222222222';

  beforeEach(async () => {
    const mockService = {
      add: jest.fn(),
      remove: jest.fn(),
      findByUser: jest.fn(),
      check: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WishlistsController],
      providers: [{ provide: WishlistsService, useValue: mockService }],
    }).compile();

    controller = module.get<WishlistsController>(WishlistsController);
    service = module.get(WishlistsService);
  });

  it('add delegates to service with user ID and productId', async () => {
    service.add.mockResolvedValue({
      success: true,
      message: 'Added to wishlist',
    } as any);

    const req = { user: mockUser };
    const res = await controller.add(req, mockProductId);

    expect(res).toEqual({ success: true, message: 'Added to wishlist' });
    expect(service.add).toHaveBeenCalledWith(mockUser.id, mockProductId);
  });

  it('remove delegates to service with user ID and productId', async () => {
    service.remove.mockResolvedValue({
      success: true,
      message: 'Removed from wishlist',
    } as any);

    const req = { user: mockUser };
    const res = await controller.remove(req, mockProductId);

    expect(res).toEqual({ success: true, message: 'Removed from wishlist' });
    expect(service.remove).toHaveBeenCalledWith(mockUser.id, mockProductId);
  });

  it('getMyWishlist returns standard ApiResponse envelope matching frontend contract', async () => {
    const mockList = [
      {
        id: 'w-1',
        userId: mockUser.id,
        productId: mockProductId,
        product: { name: 'Item' },
      },
    ];
    service.findByUser.mockResolvedValue(mockList as any);

    const req = { user: mockUser };
    const res = await controller.getMyWishlist(req);

    expect(res).toEqual({
      success: true,
      data: mockList,
    });
    expect(service.findByUser).toHaveBeenCalledWith(mockUser.id);
  });

  it('checkStatus returns standard ApiResponse envelope matching frontend contract', async () => {
    service.check.mockResolvedValue({ isFavorited: true });

    const req = { user: mockUser };
    const res = await controller.checkStatus(req, mockProductId);

    expect(res).toEqual({
      success: true,
      data: { isFavorited: true },
    });
    expect(service.check).toHaveBeenCalledWith(mockUser.id, mockProductId);
  });
});
