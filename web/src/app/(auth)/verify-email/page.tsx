import { Metadata } from "next";
import { VerifyEmailForm } from "@/components/auth/verify-email-form";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "Verify Email - Gramoz",
  description: "Verify your Gramoz account email address",
};

export default function VerifyEmailPage() {
  return (
    <div className="flex-1 flex items-center justify-center min-h-[calc(100vh-4rem)] p-4 bg-zinc-50 dark:bg-black">
      <Suspense fallback={<div className="h-96 w-full max-w-md mx-auto animate-pulse bg-zinc-200 dark:bg-zinc-800 rounded-xl"></div>}>
        <VerifyEmailForm />
      </Suspense>
    </div>
  );
}
