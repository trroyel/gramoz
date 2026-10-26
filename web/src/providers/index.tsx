"use client";

import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "./theme-provider";
import { QueryProvider } from "./query-provider";
import { CartSyncProvider } from "./cart-sync-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        <CartSyncProvider>
          {children}
        </CartSyncProvider>
        <Toaster position="top-right" />
      </ThemeProvider>
    </QueryProvider>
  );
}
