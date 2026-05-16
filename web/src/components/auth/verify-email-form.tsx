"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { MailCheck, Loader2 } from "lucide-react";
import Link from "next/link";
import { authApi } from "@/lib/api/auth";
import { verifyEmailSchema, VerifyEmailFormData } from "@/lib/validations/auth";

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function VerifyEmailForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const defaultEmail = searchParams.get("email") || "";
  
  const [isLoading, setIsLoading] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [formData, setFormData] = useState<VerifyEmailFormData>({
    email: defaultEmail,
    code: "",
  });
  const [errors, setErrors] = useState<Partial<Record<keyof VerifyEmailFormData, string>>>({});

  // Auto-update email if it changes in URL
  useEffect(() => {
    if (defaultEmail && !formData.email) {
      setFormData(prev => ({ ...prev, email: defaultEmail }));
    }
  }, [defaultEmail]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name as keyof VerifyEmailFormData]) {
      setErrors((prev) => ({ ...prev, [name]: undefined }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const result = verifyEmailSchema.safeParse(formData);
    if (!result.success) {
      const formattedErrors: Record<string, string> = {};
      result.error.issues.forEach((issue) => {
        if (issue.path[0]) {
          formattedErrors[issue.path[0].toString()] = issue.message;
        }
      });
      setErrors(formattedErrors);
      return;
    }

    setIsLoading(true);
    try {
      const response = await authApi.verifyEmail(formData);
      
      if (response.success) {
        toast.success("Email Verified!", {
          description: "Your account is now fully verified. Please log in.",
        });
        router.push("/login");
      } else {
        toast.error("Verification failed", {
          description: response.message || "Invalid or expired verification code.",
        });
      }
    } catch (error: any) {
      toast.error("Verification Error", {
        description: error?.message || "An unexpected error occurred.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = async () => {
    if (!formData.email) {
      setErrors({ email: "Please provide an email address first." });
      return;
    }

    setIsResending(true);
    try {
      const response = await authApi.resendVerification(formData.email);
      if (response.success) {
        toast.success("Code Sent", {
          description: "A new verification code has been sent to your email.",
        });
      } else {
        toast.error("Failed to send code", {
          description: response.message || "Please try again later.",
        });
      }
    } catch (error: any) {
      toast.error("Error", {
        description: error?.message || "Failed to resend verification code.",
      });
    } finally {
      setIsResending(false);
    }
  };

  return (
    <Card className="w-full max-w-md mx-auto border-0 shadow-lg dark:bg-zinc-900/50">
      <CardHeader className="space-y-2 text-center pb-6">
        <div className="flex justify-center mb-4">
          <div className="w-12 h-12 rounded-xl bg-blue-100 dark:bg-blue-900/20 flex items-center justify-center">
            <MailCheck className="w-6 h-6 text-blue-600 dark:text-blue-500" />
          </div>
        </div>
        <CardTitle className="text-2xl font-bold tracking-tight">Verify Email</CardTitle>
        <CardDescription>
          Enter the 8-digit code sent to your email address.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email Address</Label>
            <Input
              id="email"
              name="email"
              type="email"
              placeholder="you@example.com"
              value={formData.email}
              onChange={handleChange}
              disabled={isLoading || isResending}
              className={errors.email ? "border-red-500" : ""}
            />
            {errors.email && <p className="text-xs text-red-500">{errors.email}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="code">Verification Code</Label>
            <Input
              id="code"
              name="code"
              type="text"
              inputMode="numeric"
              placeholder="12345678"
              maxLength={8}
              value={formData.code}
              onChange={handleChange}
              disabled={isLoading}
              className={`text-center tracking-widest font-mono text-lg ${errors.code ? "border-red-500" : ""}`}
            />
            {errors.code && <p className="text-xs text-red-500">{errors.code}</p>}
          </div>

          <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white" disabled={isLoading}>
            {isLoading ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <MailCheck className="w-4 h-4 mr-2" />
            )}
            Verify Account
          </Button>
        </form>
      </CardContent>
      <CardFooter className="flex flex-col space-y-4 text-center">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Didn't receive the code?{" "}
          <button 
            type="button" 
            onClick={handleResend}
            disabled={isResending || isLoading}
            className="font-semibold text-blue-600 hover:underline dark:text-blue-500 disabled:opacity-50"
          >
            {isResending ? "Sending..." : "Resend"}
          </button>
        </p>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          <Link href="/login" className="hover:underline">
            Back to login
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}
