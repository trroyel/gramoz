"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { ShoppingCart, Plus, Minus } from "lucide-react";
import { Product } from "@/types";
import { useCartStore } from "@/stores/cart-store";


export function AddToCartButton({ product }: { product: Product }) {
  const [quantity, setQuantity] = useState(1);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(
    product.variants && product.variants.length > 0 ? product.variants[0].id : null
  );

  const addItem = useCartStore((s) => s.addItem);
  const isLoading = useCartStore((s) => s.isLoading);

  const selectedVariant = useMemo(() => {
    return product.variants?.find((v) => v.id === selectedVariantId) || null;
  }, [product.variants, selectedVariantId]);

  const activeStock = selectedVariant ? selectedVariant.stock : product.stock;
  const activePrice = selectedVariant ? selectedVariant.price : product.price;
  const isOutOfStock = activeStock <= 0;

  const handleDecrease = () => setQuantity((prev) => Math.max(1, prev - 1));
  const handleIncrease = () => setQuantity((prev) => Math.min(activeStock, prev + 1));

  const handleAdd = () => {
    addItem(product.id, quantity, selectedVariantId || undefined);
  };

  // Group variants by attribute name for the UI, e.g. "Color": ["Red", "Blue"]
  // But wait, the schema says: `attributes` is `Record<string, string>`. 
  // For simplicity, we just list the variants as selectable pills right now.

  return (
    <div className="space-y-6">
      {product.variants && product.variants.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Select Variant</h4>
          <div className="flex flex-wrap gap-2">
            {product.variants.map((variant) => {
              const label = Object.entries(variant.attributes || {})
                .map(([k, v]) => `${v}`)
                .join(" / ") || variant.sku || "Variant";
                
              const isSelected = variant.id === selectedVariantId;
              
              return (
                <button
                  key={variant.id}
                  onClick={() => {
                    setSelectedVariantId(variant.id);
                    setQuantity(1); // reset quantity on variant change
                  }}
                  className={`px-4 py-2 text-sm border rounded-lg transition-all ${
                    isSelected 
                      ? 'border-green-600 bg-green-50 text-green-700 dark:bg-green-900/30 dark:border-green-500 dark:text-green-400 font-medium ring-1 ring-green-600'
                      : 'border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:border-zinc-300 dark:hover:border-zinc-600 bg-white dark:bg-zinc-800'
                  } ${variant.stock <= 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <div className="flex flex-col items-start text-left">
                    <span>{label}</span>
                    <span className="text-xs opacity-80">৳{variant.price}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Show Price if variant changes it, though the parent page shows the base price. 
          We might want to show the active price here if it differs. */}
      {selectedVariant && (
        <div className="text-lg font-bold text-green-600 dark:text-green-500">
          ৳{activePrice}
        </div>
      )}

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
            disabled={isOutOfStock || quantity >= activeStock}
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
          {isLoading ? "Adding..." : (isOutOfStock ? "Out of Stock" : "Add to Cart")}
        </Button>
      </div>
    </div>
  );
}
