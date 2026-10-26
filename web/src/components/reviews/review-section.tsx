"use client";

import { Star, User as UserIcon, CheckCircle } from "lucide-react";
import { Review } from "@/types";

interface ReviewSectionProps {
  productId: string;
  initialReviews: Review[];
  averageRating?: number;
  reviewCount?: number;
}

const getImageUrl = (urlOrObj?: string | { url?: string } | unknown) => {
  if (!urlOrObj) return "";
  const url =
    typeof urlOrObj === "string" ? urlOrObj : (urlOrObj as { url?: string })?.url;
  if (!url || typeof url !== "string") return "";
  if (url.startsWith("http")) return url;
  return url.startsWith("/uploads") ? `/public${url}` : url;
};

export function ReviewSection({
  initialReviews,
  averageRating,
  reviewCount,
}: ReviewSectionProps) {
  // Only show approved reviews on the product page
  const approvedReviews = initialReviews.filter(r => r.status === 'approved');
  const totalReviews = reviewCount !== undefined ? reviewCount : approvedReviews.length;

  return (
    <div className="mt-16 border-t border-zinc-200 dark:border-zinc-800 pt-10">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Customer Reviews</h2>
          {totalReviews > 0 && averageRating !== undefined && averageRating > 0 && (
            <div className="flex items-center gap-2 mt-2">
              <div className="flex text-yellow-400">
                {[1, 2, 3, 4, 5].map((star) => (
                  <Star
                    key={star}
                    className={`w-4 h-4 ${star <= Math.round(averageRating) ? "fill-current" : "text-zinc-300 dark:text-zinc-700"}`}
                  />
                ))}
              </div>
              <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {averageRating.toFixed(1)} out of 5
              </span>
              <span className="text-sm text-zinc-500">
                ({totalReviews} verified {totalReviews === 1 ? 'review' : 'reviews'})
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
        <div className="lg:col-span-2 space-y-6">
          {approvedReviews.length === 0 ? (
            <p className="text-zinc-500">No reviews yet.</p>
          ) : (
            approvedReviews.map((review) => (
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
      </div>
    </div>
  );
}
