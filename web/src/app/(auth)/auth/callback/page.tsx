"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/auth-store";
import { authApi } from "@/lib/api/auth";
import { PLATFORM_ROLES } from "@/types";
import { Loader2 } from "lucide-react";

/**
 * This page is the redirect target after a successful Google OAuth login.
 * The backend has already set the httpOnly access_token + refresh_token cookies.
 * We just need to call /auth/me to hydrate the Zustand auth store, then redirect.
 */
export default function AuthCallbackPage() {
  const router = useRouter();
  const setAuth = useAuthStore((state) => state.setAuth);

  useEffect(() => {
    async function hydrate() {
      try {
        const response = await authApi.getMe();
        if (response.success && response.data) {
          setAuth(response.data);
          if (response.data.role && PLATFORM_ROLES.includes(response.data.role)) {
            router.replace("/admin");
          } else {
            router.replace("/");
          }
        } else {
          // Something went wrong — send back to login
          router.replace("/login?error=oauth_failed");
        }
      } catch {
        router.replace("/login?error=oauth_failed");
      }
    }

    hydrate();
  }, [router, setAuth]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-zinc-50 dark:bg-black">
      <Loader2 className="w-10 h-10 animate-spin text-green-600" />
      <p className="text-zinc-500 dark:text-zinc-400 text-sm">Signing you in…</p>
    </div>
  );
}
