import { Suspense } from "react";
import { ProductGrid } from "@/components/home/product-grid";
import { ProductFilters } from "@/components/products/product-filters";
import { ProductGridSkeleton } from "@/components/products/product-grid-skeleton";
import { productsApi } from "@/lib/api/products";
import { categoriesApi } from "@/lib/api/categories";
import { Product, Category } from "@/types";
import { SlidersHorizontal } from "lucide-react";

export const metadata = {
  title: "Products | Gramoz",
  description: "Browse our complete catalog of authentic products.",
};

// Sub-component that does the data fetch — wrapped in Suspense
async function ProductResults({
  queryParams,
}: {
  queryParams: Record<string, string>;
}) {
  let products: Product[] = [];
  try {
    const res = await productsApi.getAll(queryParams);
    if (res.success) products = res.data;
  } catch (e) {
    console.error("Failed to fetch products", e);
  }

  const totalLabel = `${products.length} product${products.length !== 1 ? "s" : ""} found`;

  return (
    <div>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">{totalLabel}</p>
      <ProductGrid showViewAll={false} initialProducts={products} compact={true} />
    </div>
  );
}

export default async function PublicProductsPage({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  const resolvedParams = await searchParams;

  const queryParams: Record<string, string> = {};
  Object.entries(resolvedParams).forEach(([key, value]) => {
    if (typeof value === "string") {
      queryParams[key] = value;
    }
  });

  // Fetch category name for the active filter chip (server side, no waterfall)
  let activeCategory: Category | undefined;
  if (queryParams.category) {
    try {
      const res = await categoriesApi.getAll();
      if (res.success && res.data) {
        activeCategory = res.data.find((c) => c.id === queryParams.category);
      }
    } catch (_) {}
  }

  const searchQuery = queryParams.q;
  const sortLabel =
    queryParams.sort === "price_asc"
      ? "Price: Low to High"
      : queryParams.sort === "price_desc"
        ? "Price: High to Low"
        : null;

  return (
    <div className="flex flex-col flex-1 bg-zinc-50 font-sans dark:bg-black">
      <div className="container px-4 mx-auto max-w-7xl py-12">
        <div className="mb-8">
          <h1 className="text-4xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            {activeCategory ? activeCategory.name : searchQuery ? `Results for "${searchQuery}"` : "All Products"}
          </h1>
          {/* Active filter chips */}
          {(activeCategory || sortLabel || queryParams.minPrice || queryParams.maxPrice) && (
            <div className="flex flex-wrap gap-2 mt-3">
              {activeCategory && (
                <span className="inline-flex items-center gap-1 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 text-xs px-2.5 py-1 rounded-full font-medium">
                  <SlidersHorizontal className="w-3 h-3" /> {activeCategory.name}
                </span>
              )}
              {sortLabel && (
                <span className="inline-flex items-center gap-1 bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 text-xs px-2.5 py-1 rounded-full font-medium">
                  {sortLabel}
                </span>
              )}
              {(queryParams.minPrice || queryParams.maxPrice) && (
                <span className="inline-flex items-center gap-1 bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 text-xs px-2.5 py-1 rounded-full font-medium">
                  ৳{queryParams.minPrice || "0"} – ৳{queryParams.maxPrice || "∞"}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col md:flex-row gap-8">
          {/* Sidebar Filters */}
          <aside className="w-full md:w-64 shrink-0">
            <div className="sticky top-24 bg-white dark:bg-zinc-900 p-6 rounded-xl border border-zinc-200 dark:border-zinc-800">
              <Suspense fallback={<div className="animate-pulse space-y-3"><div className="h-4 bg-zinc-200 dark:bg-zinc-700 rounded w-1/2" /><div className="h-4 bg-zinc-200 dark:bg-zinc-700 rounded w-3/4" /><div className="h-4 bg-zinc-200 dark:bg-zinc-700 rounded w-2/3" /></div>}>
                <ProductFilters />
              </Suspense>
            </div>
          </aside>

          {/* Product Grid */}
          <main className="flex-1 min-w-0">
            <Suspense key={JSON.stringify(queryParams)} fallback={<ProductGridSkeleton />}>
              <ProductResults queryParams={queryParams} />
            </Suspense>
          </main>
        </div>
      </div>
    </div>
  );
}
