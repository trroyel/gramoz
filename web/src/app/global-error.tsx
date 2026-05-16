"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { AlertCircle, WifiOff } from "lucide-react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error(error);
  }, [error]);

  const isNetworkError = error.message.includes("fetch") || error.message.includes("network");

  return (
    <html>
      <body>
        <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-black p-4">
          <div className="max-w-md w-full bg-white dark:bg-zinc-900 p-8 rounded-2xl shadow-sm border dark:border-zinc-800 text-center">
            <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-6">
              {isNetworkError ? (
                <WifiOff className="w-8 h-8 text-red-600 dark:text-red-500" />
              ) : (
                <AlertCircle className="w-8 h-8 text-red-600 dark:text-red-500" />
              )}
            </div>
            <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 mb-2">
              {isNetworkError ? "Connection Lost" : "Something went wrong!"}
            </h2>
            <p className="text-zinc-600 dark:text-zinc-400 mb-8">
              {isNetworkError
                ? "It looks like you're offline. Please check your internet connection and try again."
                : "An unexpected error occurred. We've been notified and are working on it."}
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button onClick={() => window.location.reload()} variant="outline" className="w-full sm:w-auto">
                Refresh Page
              </Button>
              <Button onClick={() => reset()} className="w-full sm:w-auto bg-green-600 hover:bg-green-700">
                Try Again
              </Button>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
