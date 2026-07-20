"use client";

import { useState, useRef } from "react";
import { Star, Upload } from "lucide-react";
import { reviewsApi } from "@/lib/api/reviews";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface ReviewFormModalProps {
  productId: string;
  orderId: string;
  productName: string;
  onSuccess?: () => void;
}

export function ReviewFormModal({ productId, orderId, productName, onSuccess }: ReviewFormModalProps) {
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const res = await reviewsApi.submitReview({
        productId,
        orderId,
        rating,
        comment,
        images: imageFile ? [imageFile] : undefined,
      });

      if (res.success) {
        toast.success("Review submitted! You earned loyalty points.");
        setOpen(false);
        // Reset form
        setComment("");
        setRating(5);
        setImageFile(null);
        setImagePreview(null);
        if (onSuccess) onSuccess();
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to submit review");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Star className="w-4 h-4" />
          Write Review
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Review {productName}</DialogTitle>
          <DialogDescription>
            Share your thoughts on this product and earn loyalty points!
          </DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div>
            <label className="block text-sm font-medium mb-1">Your Rating</label>
            <div className="flex gap-1 text-yellow-400">
              {[1, 2, 3, 4, 5].map((star) => (
                <button type="button" key={star} onClick={() => setRating(star)}>
                  <Star className={`w-6 h-6 ${star <= rating ? "fill-current" : "text-zinc-300 dark:text-zinc-700"}`} />
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Comment</label>
            <Textarea
              placeholder="What did you like or dislike?"
              rows={3}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Photo (Optional)</label>
            <div 
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-zinc-300 dark:border-zinc-700 rounded-lg p-6 flex flex-col items-center justify-center cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
            >
              {imagePreview ? (
                <img src={imagePreview} alt="Preview" className="h-32 object-contain" />
              ) : (
                <div className="text-center text-zinc-500 flex flex-col items-center">
                  <Upload className="w-6 h-6 mb-2" />
                  <span className="text-sm">Click to upload photo</span>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleImageChange}
              />
            </div>
          </div>

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? "Submitting..." : "Submit Review"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
