import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useCartStore } from './cart-store';
import { cartApi } from '@/lib/api/cart';
import { promosApi } from '@/lib/api/promos';
import { cartSync, CartSyncAction } from '@/lib/cart-sync';
import { toast } from 'sonner';
import { ApiResponse, Cart, CartItem } from '@/types';

// Mock dependencies
vi.mock('@/lib/api/cart', () => ({
  cartApi: {
    getCart: vi.fn(),
    addItem: vi.fn(),
    updateItem: vi.fn(),
    removeItem: vi.fn(),
    clearCart: vi.fn(),
  },
}));

vi.mock('@/lib/api/promos', () => ({
  promosApi: {
    validatePromo: vi.fn(),
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

function createMockItem(partial: Partial<CartItem>): CartItem {
  return {
    id: 'item-default',
    quantity: 1,
    productId: 'prod-default',
    productName: 'Default Product',
    productPrice: '500.00',
    productImages: [],
    productStock: 10,
    productStatus: 'active',
    variantId: undefined,
    variantPrice: undefined,
    variantStock: undefined,
    variantAttributes: undefined,
    ...partial,
  };
}

describe('useCartStore (State Reconciliation & Multi-Tab Synchronization — TASK-11)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCartStore.getState().resetCart();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetchCart', () => {
    it('should update store state when API returns empty cart data', async () => {
      vi.mocked(cartApi.getCart).mockResolvedValue({
        success: true,
        data: { items: [], subtotal: '0.00', itemCount: 0 },
      });

      await useCartStore.getState().fetchCart();

      const state = useCartStore.getState();
      expect(state.items).toEqual([]);
      expect(state.subtotal).toBe(0);
      expect(state.itemCount).toBe(0);
      expect(state.isLoading).toBe(false);
      expect(state.lastSyncedAt).toBeTypeOf('number');
    });

    it('should update store state when API returns populated cart data with variants', async () => {
      const mockCartData: Cart = {
        items: [
          createMockItem({
            id: 'item-1',
            quantity: 2,
            productId: 'prod-1',
            productName: 'Gramoz Tee',
            productPrice: '500.00',
            productStock: 10,
            variantId: 'var-1',
            variantPrice: '550.00',
            variantAttributes: { size: 'XL' },
          }),
        ],
        subtotal: '1100.00',
        itemCount: 1,
      };

      vi.mocked(cartApi.getCart).mockResolvedValue({
        success: true,
        data: mockCartData,
      });

      await useCartStore.getState().fetchCart();

      const state = useCartStore.getState();
      expect(state.items).toEqual(mockCartData.items);
      expect(state.subtotal).toBe(1100);
      expect(state.itemCount).toBe(1);
      expect(state.items[0].variantId).toBe('var-1');
      expect(state.items[0].variantPrice).toBe('550.00');
      expect(state.isLoading).toBe(false);
    });

    it('should reset promo if subtotal becomes 0', async () => {
      useCartStore.setState({ promoCode: 'DISCOUNT10', discountAmount: 100 });

      vi.mocked(cartApi.getCart).mockResolvedValue({
        success: true,
        data: { items: [], subtotal: '0.00', itemCount: 0 },
      });

      await useCartStore.getState().fetchCart();

      const state = useCartStore.getState();
      expect(state.promoCode).toBeNull();
      expect(state.discountAmount).toBe(0);
    });

    it('should capture network error without crashing and record error message', async () => {
      vi.mocked(cartApi.getCart).mockRejectedValue(new Error('Network error'));

      await useCartStore.getState().fetchCart();

      const state = useCartStore.getState();
      expect(state.error).toBe('Network error');
      expect(state.isLoading).toBe(false);
    });

    it('should prevent out-of-order API responses from corrupting state using generation counter', async () => {
      // Simulate two overlapping fetchCart calls:
      // Request 1 is slow (takes 50ms)
      // Request 2 is fast (takes 10ms)
      let resolveSlow!: (val: ApiResponse<Cart>) => void;
      const slowPromise = new Promise<ApiResponse<Cart>>((resolve) => {
        resolveSlow = resolve;
      });

      vi.mocked(cartApi.getCart)
        .mockImplementationOnce(() => slowPromise)
        .mockImplementationOnce(() =>
          Promise.resolve({
            success: true,
            data: {
              items: [createMockItem({ id: 'item-fast', quantity: 3 })],
              subtotal: '1500.00',
              itemCount: 1,
            },
          }),
        );

      // Trigger slow fetch (Request 1)
      const slowCall = useCartStore.getState().fetchCart();

      // Trigger fast fetch (Request 2)
      const fastCall = useCartStore.getState().fetchCart();
      await fastCall;

      // At this point, store has Request 2's data
      expect(useCartStore.getState().subtotal).toBe(1500);
      expect(useCartStore.getState().items[0].id).toBe('item-fast');

      // Now Request 1 resolves with older stale data
      resolveSlow({
        success: true,
        data: {
          items: [createMockItem({ id: 'item-slow', quantity: 1 })],
          subtotal: '500.00',
          itemCount: 1,
        },
      });
      await slowCall;

      // The slow response MUST be discarded because its generation is superseded!
      const finalState = useCartStore.getState();
      expect(finalState.subtotal).toBe(1500);
      expect(finalState.items[0].id).toBe('item-fast');
    });
  });

  describe('addItem', () => {
    it('should call cartApi.addItem, refresh cart, and broadcast CART_UPDATED on success', async () => {
      const broadcastSpy = vi.spyOn(cartSync, 'broadcast');

      vi.mocked(cartApi.addItem).mockResolvedValue({
        success: true,
        data: createMockItem({ id: 'item-1' }),
      });

      vi.mocked(cartApi.getCart).mockResolvedValue({
        success: true,
        data: {
          items: [createMockItem({ id: 'item-1', quantity: 2, productId: 'prod-1' })],
          subtotal: '1000.00',
          itemCount: 1,
        },
      });

      await useCartStore.getState().addItem('prod-1', 2, 'var-1');

      expect(cartApi.addItem).toHaveBeenCalledWith('prod-1', 2, 'var-1');
      expect(cartApi.getCart).toHaveBeenCalled();
      expect(toast.success).toHaveBeenCalledWith('Item added to cart');
      expect(broadcastSpy).toHaveBeenCalledWith({ type: 'CART_UPDATED' });
      expect(useCartStore.getState().subtotal).toBe(1000);
    });

    it('should handle API errors and display error toast without throwing', async () => {
      vi.mocked(cartApi.addItem).mockRejectedValue(
        new Error('Cannot add more. Only 5 units available'),
      );

      await useCartStore.getState().addItem('prod-1', 10);

      expect(toast.error).toHaveBeenCalledWith(
        'Cannot add more. Only 5 units available',
      );
      expect(useCartStore.getState().isLoading).toBe(false);
      expect(useCartStore.getState().error).toBe('Cannot add more. Only 5 units available');
    });

    it('should handle rapid repeated Add to Cart clicks sequentially', async () => {
      vi.mocked(cartApi.addItem).mockResolvedValue({
        success: true,
        data: createMockItem({ id: 'item-1' }),
      });
      vi.mocked(cartApi.getCart).mockResolvedValue({
        success: true,
        data: { items: [], subtotal: '0.00', itemCount: 0 },
      });

      await Promise.all([
        useCartStore.getState().addItem('prod-1', 1),
        useCartStore.getState().addItem('prod-1', 1),
        useCartStore.getState().addItem('prod-1', 1),
      ]);

      expect(cartApi.addItem).toHaveBeenCalledTimes(3);
    });
  });

  describe('updateQuantity', () => {
    it('should call cartApi.updateItem, refresh cart, and broadcast CART_UPDATED when quantity > 0', async () => {
      const broadcastSpy = vi.spyOn(cartSync, 'broadcast');

      vi.mocked(cartApi.updateItem).mockResolvedValue({
        success: true,
        data: createMockItem({ id: 'item-1', quantity: 4 }),
      });
      vi.mocked(cartApi.getCart).mockResolvedValue({
        success: true,
        data: {
          items: [createMockItem({ id: 'item-1', quantity: 4 })],
          subtotal: '2000.00',
          itemCount: 1,
        },
      });

      await useCartStore.getState().updateQuantity('item-1', 4);

      expect(cartApi.updateItem).toHaveBeenCalledWith('item-1', 4);
      expect(cartApi.getCart).toHaveBeenCalled();
      expect(broadcastSpy).toHaveBeenCalledWith({ type: 'CART_UPDATED' });
    });

    it('should delegate to removeItem when quantity <= 0', async () => {
      vi.mocked(cartApi.removeItem).mockResolvedValue({
        success: true,
        data: { message: 'Item removed' },
      });
      vi.mocked(cartApi.getCart).mockResolvedValue({
        success: true,
        data: { items: [], subtotal: '0.00', itemCount: 0 },
      });

      await useCartStore.getState().updateQuantity('item-1', 0);

      expect(cartApi.removeItem).toHaveBeenCalledWith('item-1');
      expect(toast.success).toHaveBeenCalledWith('Item removed');
    });

    it('should revert cart state on update error by refetching authoritative backend state', async () => {
      vi.mocked(cartApi.updateItem).mockRejectedValue(
        new Error('Only 2 units available in stock'),
      );
      vi.mocked(cartApi.getCart).mockResolvedValue({
        success: true,
        data: {
          items: [createMockItem({ id: 'item-1', quantity: 2 })],
          subtotal: '1000.00',
          itemCount: 1,
        },
      });

      await useCartStore.getState().updateQuantity('item-1', 5);

      expect(toast.error).toHaveBeenCalledWith('Only 2 units available in stock');
      expect(cartApi.getCart).toHaveBeenCalled(); // Reverts to actual backend state
    });
  });

  describe('removeItem', () => {
    it('should call cartApi.removeItem, notify success, and broadcast CART_UPDATED', async () => {
      const broadcastSpy = vi.spyOn(cartSync, 'broadcast');

      vi.mocked(cartApi.removeItem).mockResolvedValue({
        success: true,
        data: { message: 'Item removed' },
      });
      vi.mocked(cartApi.getCart).mockResolvedValue({
        success: true,
        data: { items: [], subtotal: '0.00', itemCount: 0 },
      });

      await useCartStore.getState().removeItem('item-1');

      expect(cartApi.removeItem).toHaveBeenCalledWith('item-1');
      expect(toast.success).toHaveBeenCalledWith('Item removed');
      expect(broadcastSpy).toHaveBeenCalledWith({ type: 'CART_UPDATED' });
    });
  });

  describe('clearCart & resetCart', () => {
    it('should call cartApi.clearCart, reset state, and broadcast CART_CLEARED', async () => {
      const broadcastSpy = vi.spyOn(cartSync, 'broadcast');

      useCartStore.setState({
        items: [createMockItem({ id: 'item-1' })],
        subtotal: 500,
        itemCount: 1,
        promoCode: 'SALE10',
        discountAmount: 50,
      });

      vi.mocked(cartApi.clearCart).mockResolvedValue({
        success: true,
        data: { message: 'Cart cleared' },
      });

      await useCartStore.getState().clearCart();

      const state = useCartStore.getState();
      expect(state.items).toEqual([]);
      expect(state.subtotal).toBe(0);
      expect(state.itemCount).toBe(0);
      expect(state.promoCode).toBeNull();
      expect(state.discountAmount).toBe(0);
      expect(broadcastSpy).toHaveBeenCalledWith({ type: 'CART_CLEARED' });
    });

    it('resetCart should immediately wipe client state and invalidate in-flight fetches', () => {
      useCartStore.setState({
        items: [createMockItem({ id: 'item-1' })],
        subtotal: 500,
        itemCount: 1,
        promoCode: 'SALE10',
        discountAmount: 50,
      });

      useCartStore.getState().resetCart();

      const state = useCartStore.getState();
      expect(state.items).toEqual([]);
      expect(state.subtotal).toBe(0);
      expect(state.itemCount).toBe(0);
      expect(state.promoCode).toBeNull();
      expect(state.discountAmount).toBe(0);
    });
  });

  describe('applyPromo & removePromo', () => {
    it('should apply valid promo, update discountAmount, and broadcast CART_UPDATED', async () => {
      const broadcastSpy = vi.spyOn(cartSync, 'broadcast');
      useCartStore.setState({ subtotal: 1000 });

      vi.mocked(promosApi.validatePromo).mockResolvedValue({
        promoId: 'promo-1',
        code: 'SAVE10',
        discountType: 'percentage',
        discountValue: 10,
        discountAmount: 100,
      });

      await useCartStore.getState().applyPromo('SAVE10');

      const state = useCartStore.getState();
      expect(state.promoCode).toBe('SAVE10');
      expect(state.discountAmount).toBe(100);
      expect(state.promoError).toBeNull();
      expect(toast.success).toHaveBeenCalledWith('Promo code applied: -100 ৳');
      expect(broadcastSpy).toHaveBeenCalledWith({ type: 'CART_UPDATED' });
    });

    it('should handle invalid promo error', async () => {
      useCartStore.setState({ subtotal: 1000 });

      vi.mocked(promosApi.validatePromo).mockRejectedValue(
        new Error('Coupon has expired'),
      );

      await expect(
        useCartStore.getState().applyPromo('EXPIRED'),
      ).rejects.toThrow('Coupon has expired');

      const state = useCartStore.getState();
      expect(state.promoCode).toBeNull();
      expect(state.discountAmount).toBe(0);
      expect(state.promoError).toBe('Coupon has expired');
    });

    it('should reset promo fields and broadcast on removePromo', () => {
      const broadcastSpy = vi.spyOn(cartSync, 'broadcast');
      useCartStore.setState({ promoCode: 'SAVE10', discountAmount: 100 });

      useCartStore.getState().removePromo();

      const state = useCartStore.getState();
      expect(state.promoCode).toBeNull();
      expect(state.discountAmount).toBe(0);
      expect(toast.info).toHaveBeenCalledWith('Promo code removed');
      expect(broadcastSpy).toHaveBeenCalledWith({ type: 'CART_UPDATED' });
    });
  });

  describe('initializeSync (Multi-Tab Invalidation Listener)', () => {
    it('should refetch cart when CART_UPDATED is received from another tab without echo-broadcasting', async () => {
      let syncCallback!: (action: CartSyncAction) => void;
      vi.spyOn(cartSync, 'subscribe').mockImplementation((cb) => {
        syncCallback = cb;
        return () => {};
      });

      const broadcastSpy = vi.spyOn(cartSync, 'broadcast');
      vi.mocked(cartApi.getCart).mockResolvedValue({
        success: true,
        data: {
          items: [createMockItem({ id: 'item-remote', quantity: 2 })],
          subtotal: '1000.00',
          itemCount: 1,
        },
      });

      // Initialize sync listener
      useCartStore.getState().initializeSync();

      // Simulate remote tab broadcasting CART_UPDATED
      syncCallback({
        type: 'CART_UPDATED',
        timestamp: Date.now(),
        sourceTabId: 'remote-tab',
      });

      await vi.waitFor(() => {
        expect(cartApi.getCart).toHaveBeenCalled();
        expect(useCartStore.getState().subtotal).toBe(1000);
      });

      // Crucial invariant: Remote sync MUST NOT echo-broadcast to prevent infinite loops!
      expect(broadcastSpy).not.toHaveBeenCalled();
    });

    it('should reset cart when CART_CLEARED is received from another tab', () => {
      let syncCallback!: (action: CartSyncAction) => void;
      vi.spyOn(cartSync, 'subscribe').mockImplementation((cb) => {
        syncCallback = cb;
        return () => {};
      });

      useCartStore.setState({
        items: [createMockItem({ id: 'item-1' })],
        subtotal: 500,
        itemCount: 1,
      });

      useCartStore.getState().initializeSync();

      syncCallback({
        type: 'CART_CLEARED',
        timestamp: Date.now(),
        sourceTabId: 'remote-tab',
      });

      expect(useCartStore.getState().items).toEqual([]);
      expect(useCartStore.getState().subtotal).toBe(0);
    });

    it('should reset cart when AUTH_CHANGED logged_out is received from another tab', () => {
      let syncCallback!: (action: CartSyncAction) => void;
      vi.spyOn(cartSync, 'subscribe').mockImplementation((cb) => {
        syncCallback = cb;
        return () => {};
      });

      useCartStore.setState({
        items: [createMockItem({ id: 'item-1' })],
        subtotal: 500,
        itemCount: 1,
      });

      useCartStore.getState().initializeSync();

      syncCallback({
        type: 'AUTH_CHANGED',
        status: 'logged_out',
        timestamp: Date.now(),
        sourceTabId: 'remote-tab',
      });

      expect(useCartStore.getState().items).toEqual([]);
      expect(useCartStore.getState().subtotal).toBe(0);
    });

    it('should refetch cart when AUTH_CHANGED logged_in is received from another tab', async () => {
      let syncCallback!: (action: CartSyncAction) => void;
      vi.spyOn(cartSync, 'subscribe').mockImplementation((cb) => {
        syncCallback = cb;
        return () => {};
      });

      vi.mocked(cartApi.getCart).mockResolvedValue({
        success: true,
        data: {
          items: [createMockItem({ id: 'item-user-b', quantity: 1 })],
          subtotal: '500.00',
          itemCount: 1,
        },
      });

      useCartStore.getState().initializeSync();

      syncCallback({
        type: 'AUTH_CHANGED',
        status: 'logged_in',
        userId: 'user-b',
        timestamp: Date.now(),
        sourceTabId: 'remote-tab',
      });

      await vi.waitFor(() => {
        expect(cartApi.getCart).toHaveBeenCalled();
        expect(useCartStore.getState().subtotal).toBe(500);
      });
    });
  });
});
