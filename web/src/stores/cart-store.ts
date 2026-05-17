import { create } from 'zustand';
import { cartApi } from '@/lib/api/cart';
import { CartItem } from '@/types';
import { toast } from 'sonner';

interface CartState {
  items: CartItem[];
  subtotal: number;
  itemCount: number;
  isLoading: boolean;
  
  // Actions
  fetchCart: () => Promise<void>;
  addItem: (productId: string, quantity?: number) => Promise<void>;
  removeItem: (itemId: string) => Promise<void>;
  updateQuantity: (itemId: string, quantity: number) => Promise<void>;
  clearCart: () => Promise<void>;
}

export const useCartStore = create<CartState>((set, get) => ({
  items: [],
  subtotal: 0,
  itemCount: 0,
  isLoading: false,

  fetchCart: async () => {
    set({ isLoading: true });
    try {
      const res = await cartApi.getCart();
      if (res.success) {
        set({ 
          items: res.data.items, 
          subtotal: parseFloat(res.data.subtotal || '0'),
          itemCount: res.data.itemCount
        });
      }
    } catch (error) {
      console.error('Failed to fetch cart', error);
    } finally {
      set({ isLoading: false });
    }
  },

  addItem: async (productId: string, quantity = 1) => {
    set({ isLoading: true });
    try {
      const res = await cartApi.addItem(productId, quantity);
      if (res.success) {
        toast.success('Item added to cart');
        await get().fetchCart();
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to add item to cart. Are you logged in?');
    } finally {
      set({ isLoading: false });
    }
  },

  removeItem: async (itemId: string) => {
    set({ isLoading: true });
    try {
      const res = await cartApi.removeItem(itemId);
      if (res.success) {
        toast.success('Item removed');
        await get().fetchCart();
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to remove item');
    } finally {
      set({ isLoading: false });
    }
  },

  updateQuantity: async (itemId: string, quantity: number) => {
    if (quantity <= 0) {
      return get().removeItem(itemId);
    }
    set({ isLoading: true });
    try {
      const res = await cartApi.updateItem(itemId, quantity);
      if (res.success) {
        await get().fetchCart();
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to update quantity');
      await get().fetchCart(); // Revert optimistic changes if any
    } finally {
      set({ isLoading: false });
    }
  },

  clearCart: async () => {
    set({ isLoading: true });
    try {
      const res = await cartApi.clearCart();
      if (res.success) {
        set({ items: [], subtotal: 0, itemCount: 0 });
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to clear cart');
    } finally {
      set({ isLoading: false });
    }
  },
}));
