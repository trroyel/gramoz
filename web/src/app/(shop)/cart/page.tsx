"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Minus, Plus, Trash2, ArrowLeft, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCartStore } from "@/stores/cart-store";

export default function CartPage() {
  const [isMounted, setIsMounted] = useState(false);
  const { items, updateQuantity, removeItem, clearCart } = useCartStore();

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsMounted(true);
  }, []);

  if (!isMounted) {
    return (
      <div className="container mx-auto px-4 py-16 flex items-center justify-center min-h-[60vh]">
        <div className="animate-pulse flex flex-col items-center">
          <div className="h-12 w-12 bg-muted rounded-full mb-4"></div>
          <div className="h-6 w-32 bg-muted rounded mb-2"></div>
        </div>
      </div>
    );
  }

  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  if (items.length === 0) {
    return (
      <div className="container mx-auto px-4 py-16 flex flex-col items-center justify-center min-h-[60vh] text-center">
        <div className="bg-muted/50 p-6 rounded-full mb-6">
          <ShoppingBag className="h-16 w-16 text-muted-foreground" />
        </div>
        <h1 className="text-2xl font-bold mb-2">Your cart is empty</h1>
        <p className="text-muted-foreground mb-8 max-w-md">
          Looks like you haven't added anything to your cart yet. Explore our products and find something you love.
        </p>
        <Button asChild size="lg" className="bg-green-600 hover:bg-green-700">
          <Link href="/products">Start Shopping</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 max-w-7xl py-8 md:py-12">
      <div className="flex items-center gap-2 mb-8">
        <Button variant="ghost" size="icon" asChild className="-ml-2">
          <Link href="/products">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <h1 className="text-3xl font-bold tracking-tight">Shopping Cart</h1>
      </div>

      <div className="grid lg:grid-cols-12 gap-8 lg:gap-12">
        {/* Cart Items */}
        <div className="lg:col-span-8 space-y-6">
          <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
            <div className="p-6">
              <div className="flow-root">
                <ul className="-my-6 divide-y divide-border">
                  {items.map((item) => (
                    <li key={item.id} className="flex py-6">
                      <div className="h-24 w-24 flex-shrink-0 overflow-hidden rounded-md border bg-muted relative">
                        {item.imageUrl ? (
                          <Image
                            src={item.imageUrl}
                            alt={item.name}
                            fill
                            className="object-cover object-center"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center bg-secondary">
                            <ShoppingBag className="h-8 w-8 text-muted-foreground" />
                          </div>
                        )}
                      </div>

                      <div className="ml-4 flex flex-1 flex-col justify-between">
                        <div>
                          <div className="flex justify-between text-base font-medium">
                            <h3 className="line-clamp-2 pr-4">{item.name}</h3>
                            <p className="ml-4 whitespace-nowrap text-green-600 dark:text-green-500 font-bold">
                              ৳{item.price.toLocaleString("en-IN")}
                            </p>
                          </div>
                        </div>
                        <div className="flex flex-1 items-end justify-between text-sm mt-4">
                          <div className="flex items-center rounded-md border border-input bg-background">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 rounded-none border-r border-input hover:bg-muted"
                              onClick={() => updateQuantity(item.id, item.quantity - 1)}
                              disabled={item.quantity <= 1}
                            >
                              <Minus className="h-3 w-3" />
                              <span className="sr-only">Decrease quantity</span>
                            </Button>
                            <div className="flex items-center justify-center w-12 text-center font-medium">
                              {item.quantity}
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 rounded-none border-l border-input hover:bg-muted"
                              onClick={() => updateQuantity(item.id, item.quantity + 1)}
                            >
                              <Plus className="h-3 w-3" />
                              <span className="sr-only">Increase quantity</span>
                            </Button>
                          </div>

                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive hover:bg-destructive/10 -mr-2"
                            onClick={() => removeItem(item.id)}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Remove
                          </Button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
          
          <div className="flex justify-end">
            <Button variant="outline" onClick={clearCart} className="gap-2">
              <Trash2 className="h-4 w-4" />
              Clear Cart
            </Button>
          </div>
        </div>

        {/* Order Summary */}
        <div className="lg:col-span-4">
          <div className="rounded-lg border bg-card text-card-foreground shadow-sm sticky top-24">
            <div className="p-6 flex flex-col space-y-1.5 border-b">
              <h2 className="text-xl font-semibold leading-none tracking-tight">Order Summary</h2>
            </div>
            <div className="p-6 pt-4 space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-muted-foreground">Subtotal</p>
                <p className="font-medium">৳{total.toLocaleString("en-IN")}</p>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-muted-foreground">Shipping</p>
                <p className="text-muted-foreground text-sm">Calculated at checkout</p>
              </div>
              <div className="flex items-center justify-between border-t pt-4 font-semibold text-lg">
                <p>Total</p>
                <p className="text-green-600 dark:text-green-500">
                  ৳{total.toLocaleString("en-IN")}
                </p>
              </div>
            </div>
            <div className="p-6 pt-0 mt-4">
              <Button className="w-full bg-green-600 hover:bg-green-700 text-lg py-6 h-auto" size="lg">
                Proceed to Checkout
              </Button>
              <div className="mt-4 flex justify-center text-sm text-muted-foreground">
                <p>
                  or{" "}
                  <Link href="/products" className="font-medium text-primary hover:text-primary/80 hover:underline transition-colors">
                    Continue Shopping
                  </Link>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
