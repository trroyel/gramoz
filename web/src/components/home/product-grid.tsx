"use client";

import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShoppingCart } from "lucide-react";
import { Product } from "@/types";
import { useCartStore } from "@/stores/cart-store";
import { toast } from "sonner";
import Link from "next/link";
import { getImageUrl } from "@/lib/utils";



// Isolated so cart subscription doesn't re-render the whole grid
function CartButton({ product }: { product: Product }) {
  const addItem = useCartStore((s) => s.addItem);

  const handleAdd = (e: React.MouseEvent) => {
    e.preventDefault(); // Prevent triggering the link if wrapped
    addItem(product.id, 1);
  };

  return (
    <CardFooter className="p-5 pt-0">
      <Button onClick={handleAdd} className="w-full bg-green-600 hover:bg-green-700 text-white rounded-lg">
        <ShoppingCart className="w-4 h-4 mr-2" />
        Add to Cart
      </Button>
    </CardFooter>
  );
}

interface ProductGridProps {
  title?: string;
  description?: string;
  showViewAll?: boolean;
  compact?: boolean;
  /** Products pre-fetched by the parent Server Component */
  initialProducts: Product[];
}

export function ProductGrid({
  title,
  description,
  showViewAll = false,
  compact = false,
  initialProducts,
}: ProductGridProps) {
  if (initialProducts.length === 0) {
    return (
      <div className={compact ? "py-10 text-center text-zinc-500" : "py-20"}>
        <div className={compact ? "" : "container px-4 mx-auto max-w-6xl text-center text-zinc-500"}>
          No products found.
        </div>
      </div>
    );
  }

  return (
    <div className={compact ? "" : "py-12"}>
      <div className={compact ? "" : "container px-4 mx-auto max-w-7xl"}>
        {(title || description || showViewAll) && (
          <div className="flex flex-col md:flex-row md:items-end justify-between mb-10">
            <div>
              {title && (
                <h2 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 mb-3">
                  {title}
                </h2>
              )}
              {description && (
                <p className="text-lg text-zinc-600 dark:text-zinc-400 max-w-2xl">
                  {description}
                </p>
              )}
            </div>
            {showViewAll && (
              <div className="mt-6 md:mt-0">
                <Link href="/products">
                  <Button variant="outline" className="rounded-full">
                    View All Products
                  </Button>
                </Link>
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {initialProducts.map((product) => (
            <Link key={product.id} href={`/products/${product.id}`} className="block">
              <Card className="overflow-hidden border-0 shadow-sm hover:shadow-xl transition-all duration-300 group flex flex-col h-full">
                <div className="relative aspect-square overflow-hidden bg-zinc-100 dark:bg-zinc-800">
                  <img
                    src={getImageUrl(product.images)}
                    alt={product.name}
                    loading="lazy"
                    className="object-cover w-full h-full group-hover:scale-105 transition-transform duration-500"
                  />
                  <div className="absolute top-3 left-3 bg-white/90 dark:bg-black/80 backdrop-blur-sm px-2.5 py-1 text-xs font-semibold rounded-full shadow-sm text-zinc-800 dark:text-zinc-200">
                    New
                  </div>
                </div>
                <CardContent className="p-5 flex-1">
                  <h3 className="font-semibold text-lg text-zinc-900 dark:text-zinc-100 line-clamp-1 mb-1">
                    {product.name}
                  </h3>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-2">
                    {product.categoryName} • Stock: {product.stock}
                  </p>
                  <div className="text-green-600 dark:text-green-500 font-bold text-xl">
                    ৳{product.price}
                  </div>
                </CardContent>
                <CartButton product={product} />
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
