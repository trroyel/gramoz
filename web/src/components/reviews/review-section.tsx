"use client";

import { useState, useRef } from "react";
import { Star, Upload, User as UserIcon, CheckCircle } from "lucide-react";
import { Review } from "@/types";
import { reviewsApi } from "@/lib/api/reviews";
import { toast } from "sonner";
import { useAuthStore } from "@/stores/auth-store";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface ReviewSectionProps {
  productId: string;
  initialReviews: Review[];
}

const getImageUrl = (urlOrObj?: string | { url?: string } | any) => {
  if (!urlOrObj) return "";
  const url = typeof urlOrObj === 'string' ? urlOrObj : urlOrObj?.url;
  if (!url || typeof url !== 'string') return "";
  if (url.startsWith('http')) return url;
  return url.startsWith('/uploads') ? `/public${url}` : url;
};

export function ReviewSection({ productId, initialReviews }: ReviewSectionProps) {
  const { user } = useAuthStore();
  const [reviews, setReviews] = useState<Review[]>(initialReviews);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Note: orderId is required by backend to verify purchase.
  // In a real flow, you might fetch user's past orders and let them select the order,
  // or automatically look up the orderId on backend. 
  // For this demo, since our backend requires orderId, we will let them provide an orderId,
  // or we can prompt them. Let's assume we prompt them for their order number.
  const [orderId, setOrderId] = useState("");

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
    if (!orderId) {
      toast.error("Please enter your Order ID to verify purchase.");
      return;
    }

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
        // We'll append it optimistically, or refetch
        setReviews([res.data, ...reviews]);
        setComment("");
        setRating(5);
        setOrderId("");
        setImageFile(null);
        setImagePreview(null);
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to submit review");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="mt-16 border-t border-zinc-200 dark:border-zinc-800 pt-10">
      <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 mb-8">Customer Reviews</h2>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
        <div className="lg:col-span-2 space-y-6">
          {reviews.length === 0 ? (
            <p className="text-zinc-500">No reviews yet. Be the first to review this product!</p>
          ) : (
            reviews.map((review) => (
              <div key={review.id} className="bg-white dark:bg-zinc-900 border dark:border-zinc-800 p-6 rounded-2xl shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-zinc-100 dark:bg-zinc-800 rounded-full flex items-center justify-center text-zinc-500">
                      <UserIcon className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="font-semibold text-zinc-900 dark:text-zinc-100">{review.user?.fullName || "Verified Buyer"}</p>
                      <p className="text-xs text-zinc-500 flex items-center gap-1">
                        <CheckCircle className="w-3 h-3 text-green-500" />
                        Verified Purchase
                      </p>
                    </div>
                  </div>
                  <div className="flex text-yellow-400">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Star key={star} className={`w-4 h-4 ${star <= review.rating ? "fill-current" : "text-zinc-300 dark:text-zinc-700"}`} />
                    ))}
                  </div>
                </div>
                {review.comment && (
                  <p className="text-zinc-700 dark:text-zinc-300 mb-4">{review.comment}</p>
                )}
                {review.images && review.images.length > 0 && (
                  <div className="flex gap-2">
                    {review.images.map((img, idx) => (
                      <img key={idx} src={getImageUrl(img)} alt="Review attachment" className="w-20 h-20 object-cover rounded-lg border" />
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Review Form */}
        <div className="bg-zinc-50 dark:bg-zinc-900/50 rounded-2xl p-6 border border-zinc-200 dark:border-zinc-800 h-fit">
          <h3 className="font-bold text-lg mb-4">Write a Review</h3>
          {user ? (
            <form onSubmit={handleSubmit} className="space-y-4">
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
                <label className="block text-sm font-medium mb-1">Order ID</label>
                <input
                  type="text"
                  required
                  placeholder="Paste your Order ID"
                  className="w-full px-4 py-2 border rounded-lg dark:bg-zinc-900 dark:border-zinc-800"
                  value={orderId}
                  onChange={(e) => setOrderId(e.target.value)}
                />
                <p className="text-xs text-zinc-500 mt-1">We need this to verify your purchase.</p>
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
                {isSubmitting ? "Submitting..." : "Submit Review & Earn Points"}
              </Button>
            </form>
          ) : (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Please <a href="/login" className="text-green-600 underline">login</a> to write a review.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
