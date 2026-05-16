import { Metadata } from "next";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = {
  title: "Login - Gramoz",
  description: "Login to your Gramoz account",
};

export default function LoginPage() {
  return (
    <div className="flex-1 flex items-center justify-center min-h-[calc(100vh-4rem)] p-4 bg-zinc-50 dark:bg-black">
      <LoginForm />
    </div>
  );
}
