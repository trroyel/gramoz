"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { authApi } from "@/lib/api/auth";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

interface PhoneVerificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function PhoneVerificationModal({
  isOpen,
  onClose,
  onSuccess,
}: PhoneVerificationModalProps) {
  const [countryCode, setCountryCode] = useState("+880");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [isLoading, setIsLoading] = useState(false);
  const [timeLeft, setTimeLeft] = useState(600); // 10 minutes in seconds

  // Timer effect for OTP validity
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (step === "code" && timeLeft > 0) {
      timer = setInterval(() => {
        setTimeLeft((prev) => prev - 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [step, timeLeft]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const handleSendOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!phone) {
      toast.error("Please enter your phone number");
      return;
    }

    setIsLoading(true);
    const fullPhone = `${countryCode}${phone}`;
    try {
      const res = await authApi.sendPhoneOtp({ phone: fullPhone });
      if (res.success) {
        toast.success(res.message || "OTP sent successfully!");
        setStep("code");
        setTimeLeft(600); // Reset timer to 10 minutes
      } else {
        toast.error(res.message || "Failed to send OTP");
      }
    } catch (error: any) {
      toast.error(error.message || "Something went wrong");
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code) {
      toast.error("Please enter the verification code");
      return;
    }

    setIsLoading(true);
    const fullPhone = `${countryCode}${phone}`;
    try {
      const res = await authApi.verifyPhoneOtp({ phone: fullPhone, code });
      if (res.success) {
        toast.success(res.message || "Phone number verified!");
        onSuccess();
        // Reset state for future use
        setTimeout(() => {
          setStep("phone");
          setPhone("");
          setCode("");
        }, 500);
      } else {
        toast.error(res.message || "Invalid OTP");
      }
    } catch (error: any) {
      toast.error(error.message || "Something went wrong");
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      onClose();
      // Reset after animation
      setTimeout(() => setStep("phone"), 300);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Verify Your Phone Number</DialogTitle>
          <DialogDescription>
            {step === "phone"
              ? "We need a verified phone number to send delivery updates."
              : `We sent a 6-digit code to ${countryCode}${phone}.`}
          </DialogDescription>
        </DialogHeader>

        {step === "phone" ? (
          <form onSubmit={handleSendOtp} className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="phone">Phone Number</Label>
              <div className="flex gap-2">
                <select
                  value={countryCode}
                  onChange={(e) => setCountryCode(e.target.value)}
                  className="flex h-9 w-[110px] rounded-md border border-input bg-background px-3 py-1 text-base shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
                  disabled={isLoading}
                >
                  <option value="+880">+880 (BD)</option>
                  <option value="+1">+1 (US/CA)</option>
                  <option value="+44">+44 (UK)</option>
                  <option value="+91">+91 (IN)</option>
                  <option value="+61">+61 (AU)</option>
                  <option value="+971">+971 (AE)</option>
                </select>
                <Input
                  id="phone"
                  type="tel"
                  placeholder="1712345678"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                  disabled={isLoading}
                  className="flex-1"
                />
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? "Sending..." : "Send Verification Code"}
            </Button>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp} className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="code">Verification Code</Label>
              <Input
                id="code"
                type="text"
                placeholder="123456"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                disabled={isLoading || timeLeft === 0}
              />
              <div className="flex items-center justify-between mt-2">
                <span className={`text-sm ${timeLeft > 0 ? "text-muted-foreground" : "text-destructive"}`}>
                  {timeLeft > 0 ? `Code expires in ${formatTime(timeLeft)}` : "Code expired"}
                </span>
                {timeLeft === 0 && (
                  <Button
                    type="button"
                    variant="link"
                    className="p-0 h-auto text-sm"
                    onClick={(e) => handleSendOtp(e)}
                    disabled={isLoading}
                  >
                    Resend Code
                  </Button>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => {
                  setStep("phone");
                  setTimeLeft(600);
                }}
                disabled={isLoading}
              >
                Back
              </Button>
              <Button type="submit" className="w-full" disabled={isLoading || timeLeft === 0}
              >
                {isLoading ? "Verifying..." : "Verify"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
