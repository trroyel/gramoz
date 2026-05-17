"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ShoppingCart, Plus, Minus } from "lucide-react";
import { Product } from "@/types";
import { useCartStore } from "@/stores/cart-store";

export function AddToCartButton({ product }: { product: Product }) {
  const [quantity, setQuantity] = useState(1);
  const addItem = useCartStore((s) => s.addItem);
  const isLoading = useCartStore((s) => s.isLoading);

  const isOutOfStock = product.stock <= 0;

  const handleDecrease = () => setQuantity((prev) => Math.max(1, prev - 1));
  const handleIncrease = () => setQuantity((prev) => Math.min(product.stock, prev + 1));

  const handleAdd = () => {
    addItem(product.id, quantity);
  };

  return (
    <div className="flex flex-col sm:flex-row gap-4">
      <div className="flex items-center border dark:border-zinc-700 rounded-lg bg-zinc-50 dark:bg-zinc-800 h-12 w-full sm:w-32">
        <button
          disabled={isOutOfStock}
          onClick={handleDecrease}
          className="w-10 h-full flex items-center justify-center text-zinc-500 hover:text-zinc-900 dark:hover:text-white disabled:opacity-50"
        >
          <Minus className="w-4 h-4" />
        </button>
        <span className="flex-1 text-center font-semibold text-zinc-900 dark:text-zinc-100">
          {quantity}
        </span>
        <button
          disabled={isOutOfStock || quantity >= product.stock}
          onClick={handleIncrease}
          className="w-10 h-full flex items-center justify-center text-zinc-500 hover:text-zinc-900 dark:hover:text-white disabled:opacity-50"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      <Button
        size="lg"
        disabled={isOutOfStock || isLoading}
        onClick={handleAdd}
        className="flex-1 h-12 bg-green-600 hover:bg-green-700 text-white rounded-lg shadow-lg shadow-green-600/20 text-lg"
      >
        <ShoppingCart className="w-5 h-5 mr-2" />
        {isLoading ? "Adding..." : "Add to Cart"}
      </Button>
    </div>
  );
}
