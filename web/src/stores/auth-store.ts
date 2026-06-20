import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '@/types';
import { authApi } from '@/lib/api/auth';

/**
 * Auth store — holds UI session state only.
 *
 * The JWT is stored in an httpOnly cookie set by the server on login.
 * It is NEVER accessible to JavaScript (no localStorage, no js-cookie).
 * The cookie is sent automatically with every request via `credentials: 'include'`.
 *
 * This store only tracks:
 *   - user profile (for UI display)
 *   - isAuthenticated flag (for route guards)
 */
interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  // Actions
  setAuth: (user: User) => void;
  clearAuth: () => void;        // clears local state only (used by 401 handler)
  logout: () => Promise<void>;  // calls server logout THEN clears state (used by logout button)
  setUser: (user: User) => void;
  setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,
      isLoading: false,

      setAuth: (user) => {
        // Cookie is set by the server — nothing to do client-side for the token
        set({ user, isAuthenticated: true });
      },

      // Clears local UI state only — does NOT call the server.
      // Use this from the 401 handler so we don't nuke the refresh cookie.
      clearAuth: () => {
        set({ user: null, isAuthenticated: false });
      },

      // Full logout: tell the server to clear the httpOnly cookies, then clear local state.
      logout: async () => {
        try {
          await authApi.logout();
        } catch (error) {
          console.error('Logout failed', error);
        }
        set({ user: null, isAuthenticated: false });
      },

      setUser: (user) => set({ user }),

      setLoading: (loading) => set({ isLoading: loading }),
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    },
  ),
);
