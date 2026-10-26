import { Test, TestingModule } from '@nestjs/testing';
import { CartService } from './cart.service';
import { CartStore } from './cart.store';
import {
  EntityNotFoundError,
  InvalidOperationError,
  InsufficientStockError,
} from '../../common/errors/domain.errors';

describe('CartService (Unit Tests — TASK-06)', () => {
  let service: CartService;
  let mockStore: {
    getCartItemsWithProducts: jest.Mock;
    getProductById: jest.Mock;
    getVariantById: jest.Mock;
    findCartItemById: jest.Mock;
    findCartItemByProduct: jest.Mock;
    updateCartItemQuantity: jest.Mock;
    createCartItem: jest.Mock;
    upsertCartItem: jest.Mock;
    deleteCartItem: jest.Mock;
    deleteCartByUserId: jest.Mock;
  };

  const userId = '11111111-1111-1111-1111-111111111111';
  const productId = '22222222-2222-2222-2222-222222222222';
  const variantId = '33333333-3333-3333-3333-333333333333';
  const cartItemId = '44444444-4444-4444-4444-444444444444';

  const mockProduct = {
    id: productId,
    name: 'Gramoz Oxford Shirt',
    price: '1200.00',
    stock: 10,
    status: 'active',
  };

  const mockVariant = {
    id: variantId,
    productId: productId,
    price: '1350.00',
    stock: 5,
    attributes: { size: 'L', color: 'White' },
  };

  beforeEach(async () => {
    mockStore = {
      getCartItemsWithProducts: jest.fn(),
      getProductById: jest.fn(),
      getVariantById: jest.fn(),
      findCartItemById: jest.fn(),
      findCartItemByProduct: jest.fn(),
      updateCartItemQuantity: jest.fn(),
      createCartItem: jest.fn(),
      upsertCartItem: jest.fn(),
      deleteCartItem: jest.fn(),
      deleteCartByUserId: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CartService,
        {
          provide: CartStore,
          useValue: mockStore,
        },
      ],
    }).compile();

    service = module.get<CartService>(CartService);
  });

  describe('getCart', () => {
    it('should return empty summary when cart has no items', async () => {
      mockStore.getCartItemsWithProducts.mockResolvedValue([]);

      const result = await service.getCart(userId);
      expect(result).toEqual({
        items: [],
        subtotal: '0.00',
        itemCount: 0,
      });
      expect(mockStore.getCartItemsWithProducts).toHaveBeenCalledWith(userId);
    });

    it('should calculate subtotal correctly using product prices when variants are null', async () => {
      mockStore.getCartItemsWithProducts.mockResolvedValue([
        {
          id: 'item-1',
          quantity: 2,
          productId: 'prod-1',
          productPrice: '500.00',
          variantPrice: null,
        },
        {
          id: 'item-2',
          quantity: 1,
          productId: 'prod-2',
          productPrice: '250.50',
          variantPrice: null,
        },
      ]);

      const result = await service.getCart(userId);
      // (2 * 500.00) + (1 * 250.50) = 1250.50
      expect(result.subtotal).toBe('1250.50');
      expect(result.itemCount).toBe(2);
    });

    it('should prefer variant price over product price when variant exists', async () => {
      mockStore.getCartItemsWithProducts.mockResolvedValue([
        {
          id: 'item-1',
          quantity: 3,
          productId: 'prod-1',
          productPrice: '1000.00',
          variantPrice: '1200.00', // Variant override
        },
      ]);

      const result = await service.getCart(userId);
      // 3 * 1200.00 = 3600.00
      expect(result.subtotal).toBe('3600.00');
      expect(result.itemCount).toBe(1);
    });
  });

  describe('addItem (Defensive Validation & Atomic Upsert)', () => {
    it('should reject non-positive or zero quantities with InvalidOperationError', async () => {
      await expect(
        service.addItem(userId, { productId, quantity: 0 }),
      ).rejects.toThrow(InvalidOperationError);

      await expect(
        service.addItem(userId, { productId, quantity: -2 }),
      ).rejects.toThrow(InvalidOperationError);

      await expect(
        service.addItem(userId, { productId, quantity: 1.5 }),
      ).rejects.toThrow(InvalidOperationError);
    });

    it('should throw EntityNotFoundError when product does not exist', async () => {
      mockStore.getProductById.mockResolvedValue(null);

      await expect(
        service.addItem(userId, { productId, quantity: 1 }),
      ).rejects.toThrow(EntityNotFoundError);
    });

    it('should throw InvalidOperationError when product is not active', async () => {
      mockStore.getProductById.mockResolvedValue({
        ...mockProduct,
        status: 'draft',
      });

      await expect(
        service.addItem(userId, { productId, quantity: 1 }),
      ).rejects.toThrow(InvalidOperationError);
    });

    it('should throw EntityNotFoundError when specified variantId does not exist', async () => {
      mockStore.getProductById.mockResolvedValue(mockProduct);
      mockStore.getVariantById.mockResolvedValue(null);

      await expect(
        service.addItem(userId, { productId, variantId, quantity: 1 }),
      ).rejects.toThrow(EntityNotFoundError);
    });

    it('should throw InvalidOperationError when variant belongs to a different product', async () => {
      mockStore.getProductById.mockResolvedValue(mockProduct);
      mockStore.getVariantById.mockResolvedValue({
        ...mockVariant,
        productId: 'different-product-id',
      });

      await expect(
        service.addItem(userId, { productId, variantId, quantity: 1 }),
      ).rejects.toThrow(InvalidOperationError);
    });

    it('should throw InsufficientStockError when requested quantity exceeds product stock', async () => {
      mockStore.getProductById.mockResolvedValue({
        ...mockProduct,
        stock: 3,
      });

      await expect(
        service.addItem(userId, { productId, quantity: 4 }),
      ).rejects.toThrow(InsufficientStockError);
    });

    it('should throw InsufficientStockError when requested quantity exceeds variant stock', async () => {
      mockStore.getProductById.mockResolvedValue(mockProduct);
      mockStore.getVariantById.mockResolvedValue({
        ...mockVariant,
        stock: 2,
      });

      await expect(
        service.addItem(userId, { productId, variantId, quantity: 3 }),
      ).rejects.toThrow(InsufficientStockError);
    });

    it('should atomically upsert standard product (null variant) when valid', async () => {
      mockStore.getProductById.mockResolvedValue(mockProduct);
      const expectedItem = {
        id: cartItemId,
        userId,
        productId,
        variantId: null,
        quantity: 2,
      };
      mockStore.upsertCartItem.mockResolvedValue(expectedItem);

      const result = await service.addItem(userId, {
        productId,
        quantity: 2,
      });

      expect(result).toEqual(expectedItem);
      expect(mockStore.upsertCartItem).toHaveBeenCalledWith(
        {
          userId,
          productId,
          variantId: null,
          quantity: 2,
        },
        mockProduct.stock,
      );
    });

    it('should atomically upsert product with variant when valid', async () => {
      mockStore.getProductById.mockResolvedValue(mockProduct);
      mockStore.getVariantById.mockResolvedValue(mockVariant);
      const expectedItem = {
        id: cartItemId,
        userId,
        productId,
        variantId,
        quantity: 3,
      };
      mockStore.upsertCartItem.mockResolvedValue(expectedItem);

      const result = await service.addItem(userId, {
        productId,
        variantId,
        quantity: 3,
      });

      expect(result).toEqual(expectedItem);
      expect(mockStore.upsertCartItem).toHaveBeenCalledWith(
        {
          userId,
          productId,
          variantId,
          quantity: 3,
        },
        mockVariant.stock,
      );
    });

    it('should throw InsufficientStockError when atomic upsert returns null due to stock ceiling', async () => {
      mockStore.getProductById.mockResolvedValue(mockProduct);
      // Store returns null because WHERE condition (quantity + EXCLUDED.quantity <= maxStock) prevented update
      mockStore.upsertCartItem.mockResolvedValue(null);

      await expect(
        service.addItem(userId, { productId, quantity: 2 }),
      ).rejects.toThrow(InsufficientStockError);
    });
  });

  describe('updateItem', () => {
    it('should reject invalid or non-positive quantity', async () => {
      await expect(service.updateItem(userId, cartItemId, 0)).rejects.toThrow(
        InvalidOperationError,
      );

      await expect(service.updateItem(userId, cartItemId, -1)).rejects.toThrow(
        InvalidOperationError,
      );

      await expect(service.updateItem(userId, cartItemId, 2.5)).rejects.toThrow(
        InvalidOperationError,
      );
    });

    it('should throw EntityNotFoundError when cart item does not exist', async () => {
      mockStore.findCartItemById.mockResolvedValue(null);

      await expect(service.updateItem(userId, cartItemId, 2)).rejects.toThrow(
        EntityNotFoundError,
      );
    });

    it('should throw EntityNotFoundError when associated product no longer exists', async () => {
      mockStore.findCartItemById.mockResolvedValue({
        id: cartItemId,
        userId,
        productId,
        variantId: null,
        quantity: 1,
      });
      mockStore.getProductById.mockResolvedValue(null);

      await expect(service.updateItem(userId, cartItemId, 2)).rejects.toThrow(
        EntityNotFoundError,
      );
    });

    it('should throw InsufficientStockError when updated quantity exceeds product stock', async () => {
      mockStore.findCartItemById.mockResolvedValue({
        id: cartItemId,
        userId,
        productId,
        variantId: null,
        quantity: 1,
      });
      mockStore.getProductById.mockResolvedValue({
        ...mockProduct,
        stock: 4,
      });

      await expect(service.updateItem(userId, cartItemId, 5)).rejects.toThrow(
        InsufficientStockError,
      );
    });

    it('should throw InsufficientStockError when updated quantity exceeds variant stock', async () => {
      mockStore.findCartItemById.mockResolvedValue({
        id: cartItemId,
        userId,
        productId,
        variantId,
        quantity: 1,
      });
      mockStore.getProductById.mockResolvedValue(mockProduct);
      mockStore.getVariantById.mockResolvedValue({
        ...mockVariant,
        stock: 3,
      });

      await expect(service.updateItem(userId, cartItemId, 4)).rejects.toThrow(
        InsufficientStockError,
      );
    });

    it('should successfully update quantity when within stock limits', async () => {
      mockStore.findCartItemById.mockResolvedValue({
        id: cartItemId,
        userId,
        productId,
        variantId: null,
        quantity: 1,
      });
      mockStore.getProductById.mockResolvedValue(mockProduct);
      mockStore.updateCartItemQuantity.mockResolvedValue({
        id: cartItemId,
        userId,
        productId,
        variantId: null,
        quantity: 5,
      });

      const result = await service.updateItem(userId, cartItemId, 5);
      expect(result.quantity).toBe(5);
      expect(mockStore.updateCartItemQuantity).toHaveBeenCalledWith(
        cartItemId,
        5,
        userId,
      );
    });
  });

  describe('removeItem', () => {
    it('should throw EntityNotFoundError when cart item does not exist', async () => {
      mockStore.findCartItemById.mockResolvedValue(null);

      await expect(service.removeItem(userId, cartItemId)).rejects.toThrow(
        EntityNotFoundError,
      );
    });

    it('should delete cart item when found', async () => {
      mockStore.findCartItemById.mockResolvedValue({
        id: cartItemId,
        userId,
      });
      mockStore.deleteCartItem.mockResolvedValue(undefined);

      await service.removeItem(userId, cartItemId);
      expect(mockStore.deleteCartItem).toHaveBeenCalledWith(cartItemId, userId);
    });
  });

  describe('clearCart', () => {
    it('should delete all cart items for user', async () => {
      mockStore.deleteCartByUserId.mockResolvedValue(undefined);

      await service.clearCart(userId);
      expect(mockStore.deleteCartByUserId).toHaveBeenCalledWith(userId);
    });
  });
});
