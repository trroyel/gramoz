"use client";

import { useEffect, useState } from "react";
import { Heart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWishlistStore } from "@/stores/wishlist-store";
import { useAuthStore } from "@/stores/auth-store";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

interface WishlistButtonProps {
  productId: string;
  className?: string;
  variant?: "ghost" | "outline" | "default" | "secondary";
  size?: "default" | "sm" | "lg" | "icon";
  showText?: boolean;
}

export function WishlistButton({ 
  productId, 
  className, 
  variant = "ghost", 
  size = "icon",
  showText = false
}: WishlistButtonProps) {
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();
  const { items, toggleItem, fetchWishlist } = useWishlistStore();
  const [isHovered, setIsHovered] = useState(false);
  const [isPending, setIsPending] = useState(false);

  // We check if it's favorited directly from the Zustand store array
  const isFavorited = items.includes(productId);

  // Initial fetch for the user if not already fetched
  useEffect(() => {
    if (isAuthenticated && items.length === 0) {
      // Small optimization: if items is empty, we try fetching once.
      // But we shouldn't fetch per button. Usually, this is handled 
      // globally at layout or dashboard level.
    }
  }, [isAuthenticated, items.length]);

  const handleToggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!isAuthenticated) {
      toast.error("Please login to add items to your wishlist");
      router.push("/login");
      return;
    }

    setIsPending(true);
    try {
      const added = await toggleItem(productId);
      if (added) {
        toast.success("Added to wishlist");
      } else {
        toast.success("Removed from wishlist");
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to update wishlist");
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={handleToggle}
      disabled={isPending}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={cn(
        "transition-colors",
        isFavorited && !showText ? "text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30" : "",
        className
      )}
      title={isFavorited ? "Remove from wishlist" : "Add to wishlist"}
    >
      <Heart 
        className={cn(
          showText ? "mr-2 h-4 w-4" : "h-5 w-5",
          isFavorited ? "fill-red-500 text-red-500" : (isHovered ? "text-red-500" : "text-zinc-500 dark:text-zinc-400"),
          isPending && "opacity-50"
        )} 
      />
      {showText && (isFavorited ? "Saved" : "Save")}
    </Button>
  );
}
