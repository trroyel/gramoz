import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { wishlistsApi } from './wishlists';
import { useWishlistStore } from '@/stores/wishlist-store';

describe('Frontend Wishlists API & Store Reconciliation (TASK-23)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    useWishlistStore.setState({ items: [] });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('wishlistsApi client endpoints', () => {
    it('sends POST request to add product to wishlist', async () => {
      let requestedUrl = '';
      let requestedMethod = '';

      global.fetch = vi.fn().mockImplementation((url, init) => {
        requestedUrl = String(url);
        requestedMethod = init?.method ?? 'GET';
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () => JSON.stringify({ success: true, message: 'Added to wishlist' }),
        });
      });

      const res = await wishlistsApi.add('prod-uuid-1');
      expect(requestedUrl).toContain('/wishlists/prod-uuid-1');
      expect(requestedMethod).toBe('POST');
      expect(res.success).toBe(true);
    });

    it('sends DELETE request to remove product from wishlist', async () => {
      let requestedUrl = '';
      let requestedMethod = '';

      global.fetch = vi.fn().mockImplementation((url, init) => {
        requestedUrl = String(url);
        requestedMethod = init?.method ?? 'GET';
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () => JSON.stringify({ success: true, message: 'Removed from wishlist' }),
        });
      });

      const res = await wishlistsApi.remove('prod-uuid-1');
      expect(requestedUrl).toContain('/wishlists/prod-uuid-1');
      expect(requestedMethod).toBe('DELETE');
      expect(res.success).toBe(true);
    });

    it('receives standard ApiResponse envelope from getAll() with wishlisted items', async () => {
      let requestedUrl = '';
      const mockItems = [
        {
          id: 'w-1',
          userId: 'user-1',
          productId: 'prod-uuid-1',
          createdAt: '2026-10-21T10:00:00Z',
          product: { id: 'prod-uuid-1', name: 'Handicraft Basket', price: '350.00' },
        },
      ];

      global.fetch = vi.fn().mockImplementation((url) => {
        requestedUrl = String(url);
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () => JSON.stringify({ success: true, data: mockItems }),
        });
      });

      const res = await wishlistsApi.getAll();
      expect(requestedUrl).toContain('/wishlists');
      expect(res.success).toBe(true);
      expect(res.data).toHaveLength(1);
      expect(res.data[0].productId).toBe('prod-uuid-1');
    });

    it('receives standard ApiResponse envelope from check()', async () => {
      let requestedUrl = '';

      global.fetch = vi.fn().mockImplementation((url) => {
        requestedUrl = String(url);
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () => JSON.stringify({ success: true, data: { isFavorited: true } }),
        });
      });

      const res = await wishlistsApi.check('prod-uuid-1');
      expect(requestedUrl).toContain('/wishlists/check/prod-uuid-1');
      expect(res.success).toBe(true);
      expect(res.data.isFavorited).toBe(true);
    });
  });

  describe('useWishlistStore state reconciliation', () => {
    it('correctly updates store state when fetchWishlist receives standard ApiResponse envelope', async () => {
      const mockItems = [
        {
          id: 'w-1',
          userId: 'user-1',
          productId: 'prod-101',
          createdAt: '2026-10-21T10:00:00Z',
        },
        {
          id: 'w-2',
          userId: 'user-1',
          productId: 'prod-102',
          createdAt: '2026-10-21T10:05:00Z',
        },
      ];

      global.fetch = vi.fn().mockImplementation(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () => JSON.stringify({ success: true, data: mockItems }),
        }),
      );

      await useWishlistStore.getState().fetchWishlist();
      expect(useWishlistStore.getState().items).toEqual(['prod-101', 'prod-102']);
    });

    it('toggles product in wishlist store optimistically and calls API', async () => {
      global.fetch = vi.fn().mockImplementation(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () => JSON.stringify({ success: true, message: 'Added' }),
        }),
      );

      // Add to wishlist
      const isFavAfterAdd = await useWishlistStore.getState().toggleItem('prod-201');
      expect(isFavAfterAdd).toBe(true);
      expect(useWishlistStore.getState().items).toContain('prod-201');

      // Remove from wishlist
      global.fetch = vi.fn().mockImplementation(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () => JSON.stringify({ success: true, message: 'Removed' }),
        }),
      );

      const isFavAfterRemove = await useWishlistStore.getState().toggleItem('prod-201');
      expect(isFavAfterRemove).toBe(false);
      expect(useWishlistStore.getState().items).not.toContain('prod-201');
    });
  });
});
