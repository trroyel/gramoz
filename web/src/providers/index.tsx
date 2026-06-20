"use client";

import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "./theme-provider";
import { QueryProvider } from "./query-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        {children}
        <Toaster position="top-right" />
      </ThemeProvider>
    </QueryProvider>
  );
}
