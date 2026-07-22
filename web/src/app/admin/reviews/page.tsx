"use client";

const getImageUrl = (urlOrObj?: string | { url?: string } | any) => {
  if (!urlOrObj) return "";
  const url = typeof urlOrObj === 'string' ? urlOrObj : urlOrObj?.url;
  if (!url || typeof url !== 'string') return "";
  if (url.startsWith('http')) return url;
  return url.startsWith('/uploads') ? `/public${url}` : url;
};

import { useState, useEffect } from "react";
import { Review } from "@/types";
import { reviewsApi } from "@/lib/api/reviews";
import { toast } from "sonner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Check, X, Trash2, Star, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default function AdminReviewsPage() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchReviews = async () => {
    try {
      const res = await reviewsApi.getAllAdminReviews();
      if (res.success && res.data) {
        setReviews(res.data);
      }
    } catch (err: any) {
      toast.error("Failed to load reviews");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchReviews();
  }, []);

  const handleStatusChange = async (id: string, status: 'approved' | 'rejected') => {
    try {
      const res = await reviewsApi.updateReviewStatus(id, status);
      if (res.success) {
        toast.success(`Review ${status}`);
        const updatedReview = reviews.find(r => r.id === id);
        setReviews(reviews.map(r => r.id === id ? { ...r, status } : r));
        // Immediately bust the ISR cache for the product page
        if (updatedReview?.productId) {
          await fetch('/api/revalidate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: `/products/${updatedReview.productId}` }),
          });
        }
      }
    } catch (err: any) {
      toast.error(err.message || `Failed to ${status} review`);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this review?")) return;
    try {
      const res = await reviewsApi.deleteReview(id);
      if (res.success) {
        toast.success("Review deleted");
        setReviews(reviews.filter(r => r.id !== id));
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to delete review");
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-zinc-400" />
      </div>
    );
  }

  return (
    <div className="container px-4 py-8 mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Review Moderation</h1>
        <p className="text-muted-foreground mt-2">Manage customer product reviews.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Reviews</CardTitle>
          <CardDescription>Approve or reject reviews before they appear on the storefront.</CardDescription>
        </CardHeader>
        <CardContent>
          {reviews.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">No reviews found.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Rating</TableHead>
                  <TableHead className="w-[300px]">Comment</TableHead>
                  <TableHead>Images</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reviews.map((review) => (
                  <TableRow key={review.id}>
                    <TableCell>
                      <div className="font-medium">{review.user?.fullName}</div>
                      <div className="text-xs text-muted-foreground">{review.user?.email}</div>
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate">
                      {review.product?.name || "Unknown Product"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 text-yellow-500">
                        <Star className="w-4 h-4 fill-current" />
                        <span className="font-semibold text-zinc-900 dark:text-zinc-50">{review.rating}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <p className="text-sm line-clamp-2">{review.comment || <span className="italic text-muted-foreground">No comment</span>}</p>
                    </TableCell>
                    <TableCell>
                      {review.images && review.images.length > 0 ? (
                        <div className="flex gap-1">
                          {review.images.map((img: any, idx: number) => (
                            <a key={idx} href={getImageUrl(img)} target="_blank" rel="noopener noreferrer">
                              <img
                                src={getImageUrl(img)}
                                alt={`Review image ${idx + 1}`}
                                className="w-10 h-10 object-cover rounded-md border dark:border-zinc-700 hover:opacity-80 transition"
                              />
                            </a>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs italic text-muted-foreground">None</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full capitalize
                        ${review.status === 'approved' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : ''}
                        ${review.status === 'rejected' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : ''}
                        ${review.status === 'pending' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' : ''}
                      `}>
                        {review.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {review.status !== 'approved' && (
                          <Button 
                            variant="outline" 
                            size="icon" 
                            className="text-green-600 hover:text-green-700 hover:bg-green-50"
                            onClick={() => handleStatusChange(review.id, 'approved')}
                            title="Approve"
                          >
                            <Check className="w-4 h-4" />
                          </Button>
                        )}
                        {review.status !== 'rejected' && (
                          <Button 
                            variant="outline" 
                            size="icon" 
                            className="text-orange-600 hover:text-orange-700 hover:bg-orange-50"
                            onClick={() => handleStatusChange(review.id, 'rejected')}
                            title="Reject"
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        )}
                        <Button 
                          variant="outline" 
                          size="icon" 
                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          onClick={() => handleDelete(review.id)}
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
