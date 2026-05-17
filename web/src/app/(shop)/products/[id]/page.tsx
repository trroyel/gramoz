import { Metadata } from "next";
import { notFound } from "next/navigation";
import { productsApi } from "@/lib/api/products";
import { ShoppingCart, CheckCircle, PackageX, ChevronRight, Home, ShieldCheck, Truck } from "lucide-react";
import Link from "next/link";
import { AddToCartButton } from "./add-to-cart-button";
import { getImageUrl } from "@/lib/utils";

export const revalidate = 60; // ISR: Revalidate every 60 seconds

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const resolvedParams = await params;
  try {
    const res = await productsApi.getById(resolvedParams.id);
    if (res.success && res.data) {
      const product = res.data;
      return {
        title: `${product.name} | Gramoz`,
        description: product.description || `Buy authentic ${product.name} from rural artisans in Bangladesh.`,
        openGraph: {
          images: product.images && product.images.length > 0 ? [getImageUrl([product.images[0]])] : [],
        },
      };
    }
  } catch (e) {
    // Fallback metadata if fetch fails
  }
  return {
    title: "Product Not Found | Gramoz",
  };
}

export default async function ProductDetailPage({
  params,
}: {
  params: { id: string };
}) {
  // Await params in Next.js 15+
  const resolvedParams = await params;
  
  let product;
  try {
    const res = await productsApi.getById(resolvedParams.id);
    if (res.success) {
      product = res.data;
    }
  } catch (e) {
    console.error("Failed to fetch product", e);
  }

  if (!product) {
    notFound();
  }

  const isOutOfStock = product.stock <= 0;

  return (
    <div className="flex flex-col flex-1 bg-zinc-50 dark:bg-black font-sans pb-20">
      <div className="container px-4 mx-auto max-w-7xl pt-6">
        
        {/* Breadcrumb */}
        <nav className="flex items-center text-sm text-zinc-500 mb-8 overflow-x-auto whitespace-nowrap">
          <Link href="/" className="hover:text-green-600 flex items-center">
            <Home className="w-4 h-4 mr-1" /> Home
          </Link>
          <ChevronRight className="w-4 h-4 mx-2 text-zinc-300" />
          <Link href="/products" className="hover:text-green-600">
            Products
          </Link>
          <ChevronRight className="w-4 h-4 mx-2 text-zinc-300" />
          <span className="text-zinc-900 dark:text-zinc-300 font-medium truncate">
            {product.name}
          </span>
        </nav>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-10 lg:gap-16">
          
          {/* Product Image Gallery */}
          <div className="space-y-4">
            <div className="aspect-square relative rounded-2xl overflow-hidden bg-white dark:bg-zinc-900 border dark:border-zinc-800">
              <img
                src={getImageUrl(product.images)}
                alt={product.name}
                className="w-full h-full object-cover"
              />
            </div>
            {/* If we had multiple images, map them here as thumbnails */}
            {product.images && product.images.length > 1 && (
              <div className="grid grid-cols-4 gap-4">
                {product.images.map((img: string, idx: number) => (
                  <div key={idx} className="aspect-square rounded-xl overflow-hidden bg-white border cursor-pointer hover:ring-2 ring-green-600">
                    <img src={getImageUrl([img])} alt={`Thumbnail ${idx}`} className="w-full h-full object-cover" />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Product Info */}
          <div className="flex flex-col">
            <div className="mb-2">
              <span className="inline-block px-3 py-1 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 text-xs font-semibold rounded-full">
                {product.categoryName || 'Uncategorized'}
              </span>
            </div>
            <h1 className="text-3xl md:text-4xl font-bold text-zinc-900 dark:text-zinc-50 mb-4">
              {product.name}
            </h1>
            
            <div className="flex items-center gap-4 mb-6">
              <span className="text-4xl font-bold text-green-600 dark:text-green-500">
                ৳{product.price}
              </span>
            </div>

            <p className="text-zinc-600 dark:text-zinc-400 text-lg leading-relaxed mb-8">
              {product.description || "No description available for this product. It is sourced directly from rural artisans and farmers, guaranteeing authentic quality."}
            </p>

            <div className="bg-white dark:bg-zinc-900 rounded-2xl p-6 border dark:border-zinc-800 mb-8 shadow-sm">
              <div className="flex items-center gap-3 mb-6">
                {isOutOfStock ? (
                  <div className="flex items-center text-red-600 dark:text-red-400">
                    <PackageX className="w-5 h-5 mr-2" />
                    <span className="font-semibold">Out of Stock</span>
                  </div>
                ) : (
                  <div className="flex items-center text-green-600 dark:text-green-500">
                    <CheckCircle className="w-5 h-5 mr-2" />
                    <span className="font-semibold">In Stock ({product.stock} available)</span>
                  </div>
                )}
              </div>

              {/* Client Component for Add to Cart interactivity */}
              <AddToCartButton product={product} />
            </div>

            {/* Additional details */}
            <div className="space-y-4 border-t dark:border-zinc-800 pt-8">
              <div className="flex gap-4 text-sm text-zinc-600 dark:text-zinc-400">
                <ShieldCheck className="w-5 h-5 text-green-600" />
                <span>100% Authentic Rural Product</span>
              </div>
              <div className="flex gap-4 text-sm text-zinc-600 dark:text-zinc-400">
                <Truck className="w-5 h-5 text-green-600" />
                <span>Nationwide Secure Delivery in 3-5 days</span>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
