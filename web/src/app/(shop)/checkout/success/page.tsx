"use client";

import Link from "next/link";
import { CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEffect } from "react";
import { useCartStore } from "@/stores/cart-store";

export default function CheckoutSuccessPage() {
  const { fetchCart } = useCartStore();

  useEffect(() => {
    // Refresh cart to clear local state since backend already cleared it
    fetchCart();
  }, [fetchCart]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] px-4 text-center">
      <div className="w-20 h-20 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mb-6">
        <CheckCircle className="w-10 h-10 text-green-600 dark:text-green-500" />
      </div>
      
      <h1 className="text-3xl md:text-4xl font-bold mb-4 text-zinc-900 dark:text-zinc-50">
        Payment Successful!
      </h1>
      
      <p className="text-lg text-zinc-600 dark:text-zinc-400 max-w-md mb-8">
        Thank you for your purchase. Your order is now being processed and will be shipped soon.
      </p>
      
      <div className="flex flex-col sm:flex-row gap-4">
        <Button asChild className="bg-green-600 hover:bg-green-700 h-12 px-8">
          <Link href="/dashboard/orders">View My Orders</Link>
        </Button>
        <Button asChild variant="outline" className="h-12 px-8">
          <Link href="/products">Continue Shopping</Link>
        </Button>
      </div>
    </div>
  );
}
