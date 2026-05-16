import { Metadata } from "next";
import { RegisterForm } from "@/components/auth/register-form";

export const metadata: Metadata = {
  title: "Register - Gramoz",
  description: "Create your Gramoz account",
};

export default function RegisterPage() {
  return (
    <div className="flex-1 flex items-center justify-center min-h-[calc(100vh-4rem)] p-4 bg-zinc-50 dark:bg-black">
      <RegisterForm />
    </div>
  );
}
