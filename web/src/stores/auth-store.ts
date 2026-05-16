import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import Cookies from 'js-cookie';
import type { User } from '@/types';

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  
  // Actions
  setAuth: (user: User, token: string) => void;
  clearAuth: () => void;
  setUser: (user: User) => void;
  setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,

      setAuth: (user, token) => {
        // Store token in localStorage for http-client and cookie for middleware
        if (typeof window !== 'undefined') {
          localStorage.setItem('auth-token', token);
          Cookies.set('auth-token', token, { expires: 7, path: '/' }); // 7 days
        }
        set({ user, token, isAuthenticated: true });
      },

      clearAuth: () => {
        // Clear token from localStorage and cookie
        if (typeof window !== 'undefined') {
          localStorage.removeItem('auth-token');
          Cookies.remove('auth-token', { path: '/' });
        }
        set({ user: null, token: null, isAuthenticated: false });
      },

      setUser: (user) => set({ user }),

      setLoading: (loading) => set({ isLoading: loading }),
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
