import { create } from 'zustand';
import { cartApi } from '@/lib/api/cart';
import { promosApi } from '@/lib/api/promos';
import { CartItem } from '@/types';
import { toast } from 'sonner';

interface CartState {
  items: CartItem[];
  subtotal: number;
  itemCount: number;
  isLoading: boolean;
  
  // Promo State
  promoCode: string | null;
  discountAmount: number;
  promoError: string | null;
  
  // Actions
  fetchCart: () => Promise<void>;
  addItem: (productId: string, quantity?: number) => Promise<void>;
  removeItem: (itemId: string) => Promise<void>;
  updateQuantity: (itemId: string, quantity: number) => Promise<void>;
  clearCart: () => Promise<void>;
  applyPromo: (code: string) => Promise<void>;
  removePromo: () => void;
}

export const useCartStore = create<CartState>((set, get) => ({
  items: [],
  subtotal: 0,
  itemCount: 0,
  isLoading: false,

  promoCode: null,
  discountAmount: 0,
  promoError: null,

  fetchCart: async () => {
    set({ isLoading: true });
    try {
      const res = await cartApi.getCart();
      if (res.success) {
        const newSubtotal = parseFloat(res.data.subtotal || '0');
        set({ 
          items: res.data.items, 
          subtotal: newSubtotal,
          itemCount: res.data.itemCount
        });
        
        // Re-validate promo if exists
        const { promoCode } = get();
        if (promoCode && newSubtotal > 0) {
          get().applyPromo(promoCode).catch(() => {});
        } else if (newSubtotal === 0) {
          set({ promoCode: null, discountAmount: 0, promoError: null });
        }
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
        set({ items: [], subtotal: 0, itemCount: 0, promoCode: null, discountAmount: 0, promoError: null });
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to clear cart');
    } finally {
      set({ isLoading: false });
    }
  },

  applyPromo: async (code: string) => {
    const { subtotal } = get();
    if (subtotal === 0) return;
    
    set({ isLoading: true, promoError: null });
    try {
      const res = await promosApi.validatePromo({ code, subtotal });
      set({ 
        promoCode: res.code, 
        discountAmount: res.discountAmount,
        promoError: null 
      });
      toast.success(`Promo code applied: -${res.discountAmount} ৳`);
    } catch (error: any) {
      set({ 
        promoCode: null, 
        discountAmount: 0, 
        promoError: error.message || 'Invalid promo code' 
      });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  removePromo: () => {
    set({ promoCode: null, discountAmount: 0, promoError: null });
    toast.info('Promo code removed');
  }
}));
