import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { wishlistsApi } from '@/lib/api/wishlists';

interface WishlistState {
  items: string[]; // array of product IDs
  setItems: (items: string[]) => void;
  addItem: (productId: string) => void;
  removeItem: (productId: string) => void;
  toggleItem: (productId: string) => Promise<boolean>;
  fetchWishlist: () => Promise<void>;
  clearWishlist: () => void;
}

export const useWishlistStore = create<WishlistState>()(
  persist(
    (set, get) => ({
      items: [],
      setItems: (items) => set({ items }),
      addItem: (productId) => set((state) => ({ items: [...new Set([...state.items, productId])] })),
      removeItem: (productId) => set((state) => ({ items: state.items.filter(id => id !== productId) })),
      
      toggleItem: async (productId: string) => {
        const state = get();
        const isFavorited = state.items.includes(productId);
        
        try {
          if (isFavorited) {
            await wishlistsApi.remove(productId);
            state.removeItem(productId);
            return false;
          } else {
            await wishlistsApi.add(productId);
            state.addItem(productId);
            return true;
          }
        } catch (error) {
          console.error("Failed to toggle wishlist", error);
          // throw error if you want to handle it in the component (e.g., toast)
          throw error;
        }
      },

      fetchWishlist: async () => {
        try {
          const res = await wishlistsApi.getAll();
          if (res.success) {
            const productIds = res.data.map(item => item.productId);
            set({ items: productIds });
          }
        } catch (error) {
          console.error("Failed to fetch wishlist", error);
        }
      },

      clearWishlist: () => set({ items: [] }),
    }),
    {
      name: 'wishlist-storage', // name of the item in the storage (must be unique)
    }
  )
);
