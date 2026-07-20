"use client";

import { useState } from "react";
import { toast } from "sonner";
import { refundsApi } from "@/lib/api/refunds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { AlertCircle } from "lucide-react";

interface RefundRequestModalProps {
  orderId: string;
  orderTotal: number;
  onSuccess?: () => void;
}

const REFUND_REASONS = [
  { value: "damaged_item", label: "Damaged Item" },
  { value: "wrong_item", label: "Wrong Item Received" },
  { value: "not_received", label: "Item Not Received" },
  { value: "quality_issue", label: "Quality Issue" },
  { value: "changed_mind", label: "Changed My Mind" },
  { value: "other", label: "Other" },
];

export function RefundRequestModal({ orderId, orderTotal, onSuccess }: RefundRequestModalProps) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState<number | "">(orderTotal);
  const [reason, setReason] = useState("damaged_item");
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || amount <= 0 || amount > orderTotal) {
      toast.error(`Please enter a valid amount up to ৳${orderTotal}`);
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await refundsApi.requestRefund({
        orderId,
        amount: Number(amount),
        reason,
        notes,
      });

      if (res.success) {
        toast.success(res.message || "Refund requested successfully.");
        setOpen(false);
        if (onSuccess) onSuccess();
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to submit refund request");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700">
          Request Refund
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Request a Refund</DialogTitle>
          <DialogDescription>
            Submit a request for order #{orderId}. Our team will review this and process it securely.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-900 rounded-md p-3 flex gap-2 items-start text-sm text-yellow-800 dark:text-yellow-400">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <p>Maximum refundable amount for this order is <strong>৳{orderTotal}</strong>.</p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Refund Amount (৳)</label>
            <Input
              type="number"
              step="0.01"
              min="0.01"
              max={orderTotal}
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value ? Number(e.target.value) : "")}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Reason</label>
            <select
              className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
            >
              {REFUND_REASONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Additional Notes (Optional)</label>
            <Textarea
              placeholder="Please provide any extra details..."
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <Button type="submit" className="w-full bg-red-600 hover:bg-red-700 text-white" disabled={isSubmitting}>
            {isSubmitting ? "Submitting Request..." : "Submit Refund Request"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
