import { ProductGrid } from "@/components/home/product-grid";
import { ProductFilters } from "@/components/products/product-filters";
import { productsApi } from "@/lib/api/products";
import { Product } from "@/types";

export const metadata = {
  title: "Products | Gramoz",
  description: "Browse our complete catalog of authentic products.",
};

export default async function PublicProductsPage({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  // Await searchParams in Next.js 15+
  const resolvedParams = await searchParams;
  
  const queryParams: Record<string, string> = {};
  
  // Cleanly extract all string params
  Object.entries(resolvedParams).forEach(([key, value]) => {
    if (typeof value === 'string') {
      queryParams[key] = value;
    }
  });

  // Server-side fetch
  let initialProducts: Product[] = [];
  try {
    const response = await productsApi.getAll(queryParams);
    if (response.success) {
      initialProducts = response.data;
    }
  } catch (e) {
    console.error("Failed to fetch products on server", e);
  }

  return (
    <div className="flex flex-col flex-1 bg-zinc-50 font-sans dark:bg-black">
      <div className="container px-4 mx-auto max-w-7xl py-12">
        <h1 className="text-4xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 mb-8">
          All Products
        </h1>
        
        <div className="flex flex-col md:flex-row gap-8">
          {/* Sidebar Filters */}
          <aside className="w-full md:w-64 shrink-0">
            <div className="sticky top-24 bg-white dark:bg-zinc-900 p-6 rounded-xl border dark:border-zinc-800">
              <ProductFilters />
            </div>
          </aside>

          {/* Product Grid */}
          <main className="flex-1">
            <ProductGrid showViewAll={false} initialProducts={initialProducts} compact={true} />
          </main>
        </div>
      </div>
    </div>
  );
}
