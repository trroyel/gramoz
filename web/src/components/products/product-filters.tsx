"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { X } from "lucide-react";
import { useDebounce } from "@/hooks/use-debounce";
import { Button } from "@/components/ui/button";
import { categoriesApi } from "@/lib/api/categories";
import { Category } from "@/types";

export function ProductFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Initialize from URL once on mount
  const [minPrice, setMinPrice] = useState(() => searchParams.get("minPrice") ?? "");
  const [maxPrice, setMaxPrice] = useState(() => searchParams.get("maxPrice") ?? "");
  const [category, setCategory] = useState(() => searchParams.get("category") ?? "All");
  const [sort, setSort] = useState(() => searchParams.get("sort") ?? "newest");
  const [inStockOnly, setInStockOnly] = useState(() => searchParams.get("inStock") === "true");
  const debouncedMinPrice = useDebounce(minPrice, 500);
  const debouncedMaxPrice = useDebounce(maxPrice, 500);

  const [categories, setCategories] = useState<Category[]>([]);

  useEffect(() => {
    categoriesApi.getAll().then((res) => {
      if (res.success) {
        setCategories(res.data);
      }
    });
  }, []);

  // Push new URL when filter values change
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    
    // Manage price bounds
    if (debouncedMinPrice) params.set("minPrice", debouncedMinPrice);
    else params.delete("minPrice");
    
    if (debouncedMaxPrice) params.set("maxPrice", debouncedMaxPrice);
    else params.delete("maxPrice");
    
    // Manage category
    if (category && category !== "All") params.set("category", category);
    else params.delete("category");
    
    // Manage sort
    if (sort && sort !== "newest") params.set("sort", sort);
    else params.delete("sort");
    
    // Manage stock
    if (inStockOnly) params.set("inStock", "true");
    else params.delete("inStock");
    
    router.push(`/products?${params.toString()}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedMinPrice, debouncedMaxPrice, category, sort, inStockOnly, router]);

  const clearFilters = () => {
    setMinPrice("");
    setMaxPrice("");
    setCategory("All");
    setSort("newest");
    setInStockOnly(false);
  };

  const hasActiveFilters = minPrice || maxPrice || category !== "All" || sort !== "newest" || inStockOnly;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between min-h-8">
        <h3 className="font-medium">Filter By</h3>
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8 text-xs px-2 text-muted-foreground hover:text-red-500">
            <X className="w-3 h-3 mr-1" /> Clear All
          </Button>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="category">Category</Label>
        <select
          id="category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="flex h-10 w-full items-center justify-between rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-600 focus:border-transparent dark:border-zinc-800 dark:bg-zinc-950"
        >
          <option value="All">All Categories</option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.name}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="sort">Sort By</Label>
        <select
          id="sort"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="flex h-10 w-full items-center justify-between rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-600 focus:border-transparent dark:border-zinc-800 dark:bg-zinc-950"
        >
          <option value="newest">Newest Arrivals</option>
          <option value="price_asc">Price: Low to High</option>
          <option value="price_desc">Price: High to Low</option>
        </select>
      </div>

      <div className="space-y-2">
        <Label>Price Range (৳)</Label>
        <div className="flex items-center gap-2">
          <Input
            id="min-price"
            type="number"
            placeholder="Min"
            value={minPrice}
            onChange={(e) => setMinPrice(e.target.value)}
          />
          <span className="text-zinc-500">–</span>
          <Input
            id="max-price"
            type="number"
            placeholder="Max"
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value)}
          />
        </div>
      </div>

      <div className="flex items-center space-x-2 pt-2 border-t dark:border-zinc-800">
        <input
          type="checkbox"
          id="inStock"
          checked={inStockOnly}
          onChange={(e) => setInStockOnly(e.target.checked)}
          className="h-4 w-4 rounded border-zinc-300 text-green-600 focus:ring-green-600"
        />
        <Label htmlFor="inStock" className="cursor-pointer font-normal">
          In Stock Only
        </Label>
      </div>
    </div>
  );
}
