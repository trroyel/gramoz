import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useAuthStore } from '@/stores/auth-store';
import { useCartStore } from '@/stores/cart-store';
import { cartSync } from '@/lib/cart-sync';

vi.mock('@/lib/api/auth', () => ({
  authApi: {
    logout: vi.fn().mockResolvedValue({ success: true }),
  },
}));

describe('CartSyncProvider (Lifecycle & Auth Reconciliation — TASK-11)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ user: null, isAuthenticated: false, _hasHydrated: true });
    useCartStore.getState().resetCart();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resets cart on logout via useAuthStore.logout()', async () => {
    const broadcastSpy = vi.spyOn(cartSync, 'broadcast');
    useCartStore.setState({
      items: [{ id: '1', quantity: 1, productId: 'p1', productName: 'Tee', productPrice: '100', productStock: 10, productStatus: 'active', productImages: [] }],
      subtotal: 100,
      itemCount: 1,
    });

    await useAuthStore.getState().logout();

    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useCartStore.getState().items).toEqual([]);
    expect(useCartStore.getState().subtotal).toBe(0);
    expect(broadcastSpy).toHaveBeenCalledWith({
      type: 'AUTH_CHANGED',
      status: 'logged_out',
    });
  });

  it('resets cart on session expiration via useAuthStore.clearAuth()', () => {
    const broadcastSpy = vi.spyOn(cartSync, 'broadcast');
    useCartStore.setState({
      items: [{ id: '1', quantity: 1, productId: 'p1', productName: 'Tee', productPrice: '100', productStock: 10, productStatus: 'active', productImages: [] }],
      subtotal: 100,
      itemCount: 1,
    });

    useAuthStore.getState().clearAuth();

    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useCartStore.getState().items).toEqual([]);
    expect(useCartStore.getState().subtotal).toBe(0);
    expect(broadcastSpy).toHaveBeenCalledWith({
      type: 'AUTH_CHANGED',
      status: 'logged_out',
    });
  });

  it('broadcasts AUTH_CHANGED logged_in when user authenticates via setAuth()', () => {
    const broadcastSpy = vi.spyOn(cartSync, 'broadcast');

    useAuthStore.getState().setAuth({
      id: 'user-123',
      email: 'user@example.com',
      fullName: 'Test User',
      role: 'customer',
      status: 'active',
      phone: '01700000000',
      isEmailVerified: true,
      isPhoneVerified: true,
      avatarUrl: undefined,
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(broadcastSpy).toHaveBeenCalledWith({
      type: 'AUTH_CHANGED',
      status: 'logged_in',
      userId: 'user-123',
    });
  });

  it('initializes synchronization listener and tears it down on cleanup', () => {
    const subscribeSpy = vi.spyOn(cartSync, 'subscribe');

    const cleanup = useCartStore.getState().initializeSync();
    expect(subscribeSpy).toHaveBeenCalled();

    expect(() => cleanup()).not.toThrow();
  });
});
