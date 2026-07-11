"use client";

import { useEffect, useState } from "react";
import { wishlistsApi } from "@/lib/api/wishlists";
import { Wishlist } from "@/types";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { HeartCrack, ShoppingCart, Loader2 } from "lucide-react";
import { useCartStore } from "@/stores/cart-store";
import { useWishlistStore } from "@/stores/wishlist-store";
import Link from "next/link";
import { getImageUrl } from "@/lib/utils";

export default function WishlistPage() {
  const [wishlists, setWishlists] = useState<Wishlist[]>([]);
  const [loading, setLoading] = useState(true);
  const { toggleItem } = useWishlistStore();
  const addItem = useCartStore((s) => s.addItem);

  useEffect(() => {
    fetchWishlist();
  }, []);

  const fetchWishlist = async () => {
    try {
      const res = await wishlistsApi.getAll();
      if (res.success) {
        setWishlists(res.data);
      }
    } catch (error) {
      console.error("Failed to fetch wishlist", error);
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async (productId: string) => {
    await toggleItem(productId);
    // Optimistically remove from local state
    setWishlists((prev) => prev.filter(w => w.productId !== productId));
  };

  const handleAddToCart = (productId: string) => {
    addItem(productId, 1);
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-green-600" />
      </div>
    );
  }

  if (wishlists.length === 0) {
    return (
      <div className="text-center py-20 bg-white dark:bg-zinc-950 rounded-xl border border-zinc-200 dark:border-zinc-800">
        <HeartCrack className="mx-auto h-16 w-16 text-zinc-300 dark:text-zinc-700 mb-4" />
        <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 mb-2">Your wishlist is empty</h2>
        <p className="text-zinc-500 dark:text-zinc-400 mb-6">Looks like you haven't saved any products yet.</p>
        <Link href="/products">
          <Button className="bg-green-600 hover:bg-green-700">
            Start Shopping
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">My Wishlist</h1>
      
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {wishlists.map((item) => {
          if (!item.product) return null;
          return (
            <Card key={item.id} className="overflow-hidden border-0 shadow-sm hover:shadow-md transition-all">
              <Link href={`/products/${item.productId}`}>
                <div className="relative aspect-square overflow-hidden bg-zinc-100 dark:bg-zinc-800">
                  <img
                    src={getImageUrl(item.product.images)}
                    alt={item.product.name}
                    className="object-cover w-full h-full hover:scale-105 transition-transform duration-500"
                  />
                </div>
              </Link>
              <CardContent className="p-4">
                <Link href={`/products/${item.productId}`}>
                  <h3 className="font-semibold text-lg text-zinc-900 dark:text-zinc-100 line-clamp-1 mb-1 hover:text-green-600">
                    {item.product.name}
                  </h3>
                </Link>
                <div className="text-green-600 font-bold text-xl mb-2">
                  ৳{item.product.price}
                </div>
              </CardContent>
              <CardFooter className="p-4 pt-0 flex gap-2">
                <Button 
                  onClick={() => handleAddToCart(item.productId)} 
                  className="flex-1 bg-green-600 hover:bg-green-700"
                >
                  <ShoppingCart className="h-4 w-4 mr-2" /> Cart
                </Button>
                <Button 
                  variant="outline"
                  onClick={() => handleRemove(item.productId)} 
                  className="text-red-500 hover:text-red-600 hover:bg-red-50"
                  title="Remove from wishlist"
                >
                  <HeartCrack className="h-4 w-4" />
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
