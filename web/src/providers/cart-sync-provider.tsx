"use client";

import { useEffect } from "react";
import { useCartStore } from "@/stores/cart-store";
import { useAuthStore } from "@/stores/auth-store";

export function CartSyncProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, _hasHydrated } = useAuthStore();
  const fetchCart = useCartStore((s) => s.fetchCart);
  const resetCart = useCartStore((s) => s.resetCart);
  const initializeSync = useCartStore((s) => s.initializeSync);

  // Initialize cross-tab synchronization listeners
  useEffect(() => {
    const cleanup = initializeSync();
    return () => cleanup();
  }, [initializeSync]);

  // Synchronize cart with PostgreSQL on auth state change / hydration
  useEffect(() => {
    if (!_hasHydrated) return;

    if (isAuthenticated) {
      fetchCart({ silent: true }).catch(() => {});
    } else {
      resetCart();
    }
  }, [isAuthenticated, _hasHydrated, fetchCart, resetCart]);

  // Tab visibility / window focus reconciliation
  useEffect(() => {
    const handleReconcile = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        if (useAuthStore.getState().isAuthenticated) {
          const lastSynced = useCartStore.getState().lastSyncedAt;
          // If last sync was > 15 seconds ago or never synced, reconcile with server
          if (!lastSynced || Date.now() - lastSynced > 15000) {
            fetchCart({ silent: true }).catch(() => {});
          }
        }
      }
    };

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleReconcile);
    }
    if (typeof window !== "undefined") {
      window.addEventListener("focus", handleReconcile);
    }

    return () => {
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleReconcile);
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("focus", handleReconcile);
      }
    };
  }, [fetchCart]);

  return <>{children}</>;
}
