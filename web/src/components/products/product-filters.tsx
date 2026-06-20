"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { categoriesApi } from "@/lib/api/categories";
import { Category } from "@/types";
import { SlidersHorizontal, X, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const SORT_OPTIONS = [
  { value: "newest", label: "Newest" },
  { value: "price_asc", label: "Price: Low to High" },
  { value: "price_desc", label: "Price: High to Low" },
];

interface SectionProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

function FilterSection({ title, children, defaultOpen = true }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-zinc-200 dark:border-zinc-800 pb-4 mb-4 last:border-0 last:mb-0 last:pb-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100 hover:text-green-600 dark:hover:text-green-400 transition-colors"
      >
        {title}
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>
      {open && children}
    </div>
  );
}

export function ProductFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [categories, setCategories] = useState<Category[]>([]);

  // Local state for price inputs (only applied on blur / Enter)
  const [minPrice, setMinPrice] = useState(searchParams.get("minPrice") ?? "");
  const [maxPrice, setMaxPrice] = useState(searchParams.get("maxPrice") ?? "");

  const activeCategory = searchParams.get("category") ?? "";
  const activeSort = searchParams.get("sort") ?? "newest";
  const activeMin = searchParams.get("minPrice") ?? "";
  const activeMax = searchParams.get("maxPrice") ?? "";

  const hasFilters = activeCategory || activeSort !== "newest" || activeMin || activeMax;

  useEffect(() => {
    categoriesApi.getAll().then((res) => {
      if (res.success && res.data) setCategories(res.data);
    });
  }, []);

  // Sync local price state if URL changes externally (e.g. back button)
  useEffect(() => {
    setMinPrice(searchParams.get("minPrice") ?? "");
    setMaxPrice(searchParams.get("maxPrice") ?? "");
  }, [searchParams]);

  function updateParam(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === null || value === "") {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    // Reset to page 1 when any filter changes
    params.delete("page");
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  }

  function applyPriceRange() {
    const params = new URLSearchParams(searchParams.toString());
    if (minPrice) params.set("minPrice", minPrice); else params.delete("minPrice");
    if (maxPrice) params.set("maxPrice", maxPrice); else params.delete("maxPrice");
    params.delete("page");
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  }

  function clearAll() {
    setMinPrice("");
    setMaxPrice("");
    startTransition(() => {
      router.push(pathname);
    });
  }

  return (
    <div className={cn("transition-opacity", isPending && "opacity-60 pointer-events-none")}>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="w-4 h-4 text-green-600" />
          <span className="font-bold text-sm text-zinc-900 dark:text-zinc-50">Filters</span>
        </div>
        {hasFilters && (
          <button
            onClick={clearAll}
            className="flex items-center gap-1 text-xs text-red-500 hover:text-red-600 transition-colors"
          >
            <X className="w-3 h-3" /> Clear all
          </button>
        )}
      </div>

      {/* Categories */}
      <FilterSection title="Category">
        <ul className="space-y-1">
          <li>
            <button
              onClick={() => updateParam("category", null)}
              className={cn(
                "w-full text-left text-sm px-2 py-1.5 rounded-lg transition-colors",
                !activeCategory
                  ? "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400 font-medium"
                  : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              )}
            >
              All Categories
            </button>
          </li>
          {categories.map((cat) => (
            <li key={cat.id}>
              <button
                onClick={() => updateParam("category", cat.id)}
                className={cn(
                  "w-full text-left text-sm px-2 py-1.5 rounded-lg transition-colors",
                  activeCategory === cat.id
                    ? "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400 font-medium"
                    : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                )}
              >
                {cat.name}
              </button>
            </li>
          ))}
        </ul>
      </FilterSection>

      {/* Sort */}
      <FilterSection title="Sort By">
        <ul className="space-y-1">
          {SORT_OPTIONS.map((opt) => (
            <li key={opt.value}>
              <button
                onClick={() => updateParam("sort", opt.value === "newest" ? null : opt.value)}
                className={cn(
                  "w-full text-left text-sm px-2 py-1.5 rounded-lg transition-colors",
                  activeSort === opt.value || (opt.value === "newest" && !searchParams.get("sort"))
                    ? "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400 font-medium"
                    : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                )}
              >
                {opt.label}
              </button>
            </li>
          ))}
        </ul>
      </FilterSection>

      {/* Price Range */}
      <FilterSection title="Price Range (৳)">
        <div className="space-y-3">
          <div className="flex gap-2 items-center">
            <div className="flex-1">
              <label className="text-xs text-zinc-500 mb-1 block">Min</label>
              <input
                type="number"
                min="0"
                placeholder="0"
                value={minPrice}
                onChange={(e) => setMinPrice(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applyPriceRange()}
                className="w-full text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-1.5 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              />
            </div>
            <span className="text-zinc-400 pt-4">—</span>
            <div className="flex-1">
              <label className="text-xs text-zinc-500 mb-1 block">Max</label>
              <input
                type="number"
                min="0"
                placeholder="∞"
                value={maxPrice}
                onChange={(e) => setMaxPrice(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applyPriceRange()}
                className="w-full text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-1.5 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              />
            </div>
          </div>
          <Button
            size="sm"
            className="w-full bg-green-600 hover:bg-green-700 text-white"
            onClick={applyPriceRange}
          >
            Apply
          </Button>
        </div>
      </FilterSection>
    </div>
  );
}
