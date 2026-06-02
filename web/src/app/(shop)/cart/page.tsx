"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Trash2, Minus, Plus, ShoppingBag, ArrowRight } from "lucide-react";
import { useCartStore } from "@/stores/cart-store";
import { useAuthStore } from "@/stores/auth-store";
import { getImageUrl } from "@/lib/utils";

export default function CartPage() {
  const router = useRouter();
  const { items, subtotal, isLoading, fetchCart, updateQuantity, removeItem, clearCart } = useCartStore();
  const { isAuthenticated } = useAuthStore();
  
  useEffect(() => {
    if (isAuthenticated) {
      fetchCart();
    }
  }, [isAuthenticated, fetchCart]);

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
        <ShoppingBag className="w-20 h-20 text-zinc-300 dark:text-zinc-700 mb-6" />
        <h2 className="text-2xl font-bold mb-2">Please Login to View Cart</h2>
        <p className="text-zinc-500 mb-6">You need an account to add items to your cart and checkout.</p>
        <Button asChild className="bg-green-600 hover:bg-green-700">
          <Link href="/login?redirect=/cart">Login to Continue</Link>
        </Button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
        <ShoppingBag className="w-20 h-20 text-zinc-300 dark:text-zinc-700 mb-6" />
        <h2 className="text-2xl font-bold mb-2">Your Cart is Empty</h2>
        <p className="text-zinc-500 mb-6">Looks like you haven't added anything to your cart yet.</p>
        <Button asChild className="bg-green-600 hover:bg-green-700">
          <Link href="/products">Continue Shopping</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="container px-4 mx-auto max-w-7xl py-12">
      <h1 className="text-3xl font-bold mb-8">Shopping Cart</h1>
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white dark:bg-zinc-900 border dark:border-zinc-800 rounded-2xl p-6">
            <div className="flex justify-between items-center mb-6 pb-4 border-b dark:border-zinc-800">
              <h2 className="font-semibold text-lg text-zinc-800 dark:text-zinc-200">Cart Items ({items.length})</h2>
              <Button variant="ghost" size="sm" onClick={() => clearCart()} disabled={isLoading} className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30">
                Clear Cart
              </Button>
            </div>
            
            <div className="space-y-6">
              {items.map((item) => (
                <div key={item.id} className="flex gap-4 sm:gap-6 py-2">
                  <div className="w-24 h-24 sm:w-32 sm:h-32 rounded-xl overflow-hidden bg-zinc-100 dark:bg-zinc-800 shrink-0 border border-zinc-200 dark:border-zinc-700">
                    <img
                      src={getImageUrl(item.productImages)}
                      alt={item.productName}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  
                  <div className="flex flex-col flex-1 justify-between">
                    <div className="flex justify-between items-start">
                      <div>
                        <Link href={`/products/${item.productId}`} className="font-semibold text-lg text-zinc-900 dark:text-zinc-100 hover:text-green-600 line-clamp-2">
                          {item.productName}
                        </Link>
                        <p className="text-green-600 dark:text-green-500 font-bold mt-1">
                          ৳{item.productPrice}
                        </p>
                      </div>
                      <button 
                        onClick={() => removeItem(item.id)}
                        disabled={isLoading}
                        className="text-zinc-400 hover:text-red-500 p-2 -mr-2 -mt-2 transition-colors"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                    
                    <div className="flex justify-between items-end mt-4">
                      <div className="flex items-center border dark:border-zinc-700 rounded-lg bg-zinc-50 dark:bg-zinc-800 h-10 w-32">
                        <button
                          disabled={item.quantity <= 1 || isLoading}
                          onClick={() => updateQuantity(item.id, item.quantity - 1)}
                          className="w-10 h-full flex items-center justify-center text-zinc-500 hover:text-zinc-900 dark:hover:text-white disabled:opacity-50"
                        >
                          <Minus className="w-4 h-4" />
                        </button>
                        <span className="flex-1 text-center font-medium text-sm">
                          {item.quantity}
                        </span>
                        <button
                          disabled={item.quantity >= item.productStock || isLoading}
                          onClick={() => updateQuantity(item.id, item.quantity + 1)}
                          className="w-10 h-full flex items-center justify-center text-zinc-500 hover:text-zinc-900 dark:hover:text-white disabled:opacity-50"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>
                      
                      <div className="font-bold text-lg text-zinc-900 dark:text-zinc-50">
                        ৳{(parseFloat(item.productPrice) * item.quantity).toFixed(2)}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        
        <div className="lg:col-span-1">
          <div className="bg-white dark:bg-zinc-900 border dark:border-zinc-800 rounded-2xl p-6 sticky top-24 shadow-sm">
            <h2 className="font-semibold text-lg mb-6 border-b dark:border-zinc-800 pb-4">Order Summary</h2>
            
            <div className="space-y-4 mb-6">
              <div className="flex justify-between text-zinc-600 dark:text-zinc-400">
                <span>Subtotal</span>
                <span>৳{subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-zinc-600 dark:text-zinc-400">
                <span>Shipping</span>
                <span>Calculated at checkout</span>
              </div>
              
              <div className="border-t dark:border-zinc-800 pt-4 mt-4">
                <div className="flex justify-between font-bold text-xl text-zinc-900 dark:text-zinc-50">
                  <span>Total</span>
                  <span>৳{subtotal.toFixed(2)}</span>
                </div>
              </div>
            </div>
            
            <Button 
              onClick={() => router.push("/checkout")}
              className="w-full h-14 text-lg bg-green-600 hover:bg-green-700 shadow-lg shadow-green-600/20 rounded-xl"
              disabled={isLoading || items.length === 0}
            >
              Proceed to Checkout
              <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
            
            <div className="mt-6 flex items-center justify-center gap-2 text-sm text-zinc-500">
              <span>Secure checkout provided by</span>
              <span className="font-semibold text-zinc-800 dark:text-zinc-200">SSLCommerz</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
