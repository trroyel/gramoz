import { Test, TestingModule } from '@nestjs/testing';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';
import type { User } from '@database/schema';

describe('CartController (Unit Tests — TASK-06)', () => {
  let controller: CartController;
  let mockService: {
    getCart: jest.Mock;
    addItem: jest.Mock;
    updateItem: jest.Mock;
    removeItem: jest.Mock;
    clearCart: jest.Mock;
  };

  const mockUser: User = {
    id: 'user-uuid-1111',
    email: 'test@gramoz.com',
    passwordHash: 'hash',
    fullName: 'Test User',
    phone: null,
    avatarUrl: null,
    provider: 'local',
    providerId: null,
    role: 'customer',
    isEmailVerified: true,
    isPhoneVerified: false,
    status: 'active',
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  beforeEach(async () => {
    mockService = {
      getCart: jest.fn(),
      addItem: jest.fn(),
      updateItem: jest.fn(),
      removeItem: jest.fn(),
      clearCart: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CartController],
      providers: [
        {
          provide: CartService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<CartController>(CartController);
  });

  it('getCart: should return cart summary for current user', async () => {
    const summary = { items: [], subtotal: '0.00', itemCount: 0 };
    mockService.getCart.mockResolvedValue(summary);

    const result = await controller.getCart(mockUser);
    expect(result).toEqual(summary);
    expect(mockService.getCart).toHaveBeenCalledWith(mockUser.id);
  });

  it('addItem: should delegate to CartService.addItem and return wrapped response', async () => {
    const dto = { productId: 'prod-1', quantity: 2, variantId: 'var-1' };
    const createdItem = { id: 'item-1', ...dto, userId: mockUser.id };
    mockService.addItem.mockResolvedValue(createdItem);

    const result = await controller.addItem(mockUser, dto);
    expect(result).toEqual({
      message: 'Item added to cart',
      data: createdItem,
    });
    expect(mockService.addItem).toHaveBeenCalledWith(mockUser.id, dto);
  });

  it('updateItem: should delegate to CartService.updateItem and return wrapped response', async () => {
    const updatedItem = { id: 'item-1', quantity: 5, userId: mockUser.id };
    mockService.updateItem.mockResolvedValue(updatedItem);

    const result = await controller.updateItem(mockUser, 'item-1', {
      quantity: 5,
    });
    expect(result).toEqual({
      message: 'Cart updated',
      data: updatedItem,
    });
    expect(mockService.updateItem).toHaveBeenCalledWith(
      mockUser.id,
      'item-1',
      5,
    );
  });

  it('removeItem: should delegate to CartService.removeItem and return success message', async () => {
    mockService.removeItem.mockResolvedValue(undefined);

    const result = await controller.removeItem(mockUser, 'item-1');
    expect(result).toEqual({ message: 'Item removed from cart' });
    expect(mockService.removeItem).toHaveBeenCalledWith(mockUser.id, 'item-1');
  });

  it('clearCart: should delegate to CartService.clearCart and return success message', async () => {
    mockService.clearCart.mockResolvedValue(undefined);

    const result = await controller.clearCart(mockUser);
    expect(result).toEqual({ message: 'Cart cleared' });
    expect(mockService.clearCart).toHaveBeenCalledWith(mockUser.id);
  });
});
