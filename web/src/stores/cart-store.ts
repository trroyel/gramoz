import { create } from 'zustand';
import { cartApi } from '@/lib/api/cart';
import { promosApi } from '@/lib/api/promos';
import { CartItem } from '@/types';
import { toast } from 'sonner';
import { cartSync } from '@/lib/cart-sync';

export interface CartState {
  items: CartItem[];
  subtotal: number;
  itemCount: number;
  isLoading: boolean;
  isSyncing: boolean;
  error: string | null;

  // Promo State
  promoCode: string | null;
  discountAmount: number;
  promoError: string | null;

  // Synchronization & Versioning
  lastSyncedAt: number | null;
  fetchGeneration: number;

  // Actions
  fetchCart: (options?: { silent?: boolean; isSync?: boolean }) => Promise<void>;
  addItem: (
    productId: string,
    quantity?: number,
    variantId?: string,
  ) => Promise<void>;
  removeItem: (itemId: string) => Promise<void>;
  updateQuantity: (itemId: string, quantity: number) => Promise<void>;
  clearCart: () => Promise<void>;
  resetCart: () => void;
  applyPromo: (code: string, options?: { broadcast?: boolean }) => Promise<void>;
  removePromo: () => void;
  initializeSync: () => () => void;
}

let fetchGenerationCounter = 0;

export const useCartStore = create<CartState>((set, get) => ({
  items: [],
  subtotal: 0,
  itemCount: 0,
  isLoading: false,
  isSyncing: false,
  error: null,

  promoCode: null,
  discountAmount: 0,
  promoError: null,

  lastSyncedAt: null,
  fetchGeneration: 0,

  fetchCart: async (options?: { silent?: boolean; isSync?: boolean }) => {
    const currentGeneration = ++fetchGenerationCounter;
    set({
      fetchGeneration: currentGeneration,
      isLoading: !options?.silent,
      isSyncing: !!options?.isSync,
      error: null,
    });

    try {
      const res = await cartApi.getCart();

      // Guard against out-of-order API responses
      if (currentGeneration < fetchGenerationCounter) {
        return;
      }

      if (res.success && res.data) {
        const newSubtotal = parseFloat(res.data.subtotal || '0');
        set({
          items: res.data.items || [],
          subtotal: newSubtotal,
          itemCount: res.data.itemCount || 0,
          lastSyncedAt: Date.now(),
          error: null,
        });

        // Re-validate promo if exists
        const { promoCode } = get();
        if (promoCode && newSubtotal > 0) {
          get()
            .applyPromo(promoCode, { broadcast: false })
            .catch(() => {});
        } else if (newSubtotal === 0) {
          set({ promoCode: null, discountAmount: 0, promoError: null });
        }
      }
    } catch (error: unknown) {
      if (currentGeneration < fetchGenerationCounter) return;
      const msg = error instanceof Error ? error.message : 'Failed to fetch cart';
      set({ error: msg });
      console.error('Failed to fetch cart', error);
    } finally {
      if (currentGeneration === fetchGenerationCounter) {
        set({ isLoading: false, isSyncing: false });
      }
    }
  },

  addItem: async (productId: string, quantity = 1, variantId?: string) => {
    set({ isLoading: true, error: null });
    try {
      const res = await cartApi.addItem(productId, quantity, variantId);
      if (res.success) {
        toast.success('Item added to cart');
        await get().fetchCart();
        cartSync.broadcast({ type: 'CART_UPDATED' });
      }
    } catch (error: unknown) {
      const msg =
        error instanceof Error
          ? error.message
          : 'Failed to add item to cart. Are you logged in?';
      toast.error(msg);
      set({ error: msg });
    } finally {
      set({ isLoading: false });
    }
  },

  removeItem: async (itemId: string) => {
    set({ isLoading: true, error: null });
    try {
      const res = await cartApi.removeItem(itemId);
      if (res.success) {
        toast.success('Item removed');
        await get().fetchCart();
        cartSync.broadcast({ type: 'CART_UPDATED' });
      }
    } catch (error: unknown) {
      const msg =
        error instanceof Error ? error.message : 'Failed to remove item';
      toast.error(msg);
      set({ error: msg });
    } finally {
      set({ isLoading: false });
    }
  },

  updateQuantity: async (itemId: string, quantity: number) => {
    if (quantity <= 0) {
      return get().removeItem(itemId);
    }
    set({ isLoading: true, error: null });
    try {
      const res = await cartApi.updateItem(itemId, quantity);
      if (res.success) {
        await get().fetchCart();
        cartSync.broadcast({ type: 'CART_UPDATED' });
      }
    } catch (error: unknown) {
      const msg =
        error instanceof Error ? error.message : 'Failed to update quantity';
      toast.error(msg);
      set({ error: msg });
      await get().fetchCart(); // Revert to authoritative backend state
    } finally {
      set({ isLoading: false });
    }
  },

  clearCart: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await cartApi.clearCart();
      if (res.success) {
        get().resetCart();
        cartSync.broadcast({ type: 'CART_CLEARED' });
      }
    } catch (error: unknown) {
      const msg =
        error instanceof Error ? error.message : 'Failed to clear cart';
      toast.error(msg);
      set({ error: msg });
    } finally {
      set({ isLoading: false });
    }
  },

  resetCart: () => {
    fetchGenerationCounter++;
    set({
      items: [],
      subtotal: 0,
      itemCount: 0,
      promoCode: null,
      discountAmount: 0,
      promoError: null,
      error: null,
      isLoading: false,
      isSyncing: false,
      fetchGeneration: fetchGenerationCounter,
    });
  },

  applyPromo: async (code: string, options?: { broadcast?: boolean }) => {
    const { subtotal } = get();
    if (subtotal === 0) return;

    set({ isLoading: true, promoError: null, error: null });
    try {
      const res = await promosApi.validatePromo({ code, subtotal });
      set({
        promoCode: res.code,
        discountAmount: res.discountAmount,
        promoError: null,
      });
      if (options?.broadcast !== false) {
        toast.success(`Promo code applied: -${res.discountAmount} ৳`);
        cartSync.broadcast({ type: 'CART_UPDATED' });
      }
    } catch (error: unknown) {
      const msg =
        error instanceof Error ? error.message : 'Invalid promo code';
      set({
        promoCode: null,
        discountAmount: 0,
        promoError: msg,
      });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  removePromo: () => {
    set({ promoCode: null, discountAmount: 0, promoError: null });
    toast.info('Promo code removed');
    cartSync.broadcast({ type: 'CART_UPDATED' });
  },

  initializeSync: () => {
    const unsubscribe = cartSync.subscribe((action) => {
      if (action.type === 'CART_UPDATED') {
        get().fetchCart({ silent: true, isSync: true }).catch(() => {});
      } else if (action.type === 'CART_CLEARED') {
        get().resetCart();
      } else if (action.type === 'AUTH_CHANGED') {
        if (action.status === 'logged_out') {
          get().resetCart();
        } else if (action.status === 'logged_in') {
          get().fetchCart({ silent: true, isSync: true }).catch(() => {});
        }
      }
    });
    return unsubscribe;
  },
}));
