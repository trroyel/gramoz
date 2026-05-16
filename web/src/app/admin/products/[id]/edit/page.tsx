"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { CreateProductForm } from "@/components/products/create-product-form";
import { productsApi } from "@/lib/api/products";
import { Product } from "@/types";
import { toast } from "sonner";

export default function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { id } = use(params);
  const [product, setProduct] = useState<Product | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchProduct = async () => {
      try {
        const response = await productsApi.getById(id);
        if (response.success && response.data) {
          setProduct(response.data);
        } else {
          toast.error("Product not found");
          router.push("/dashboard/products");
        }
      } catch (error) {
        console.error("Failed to fetch product:", error);
        toast.error("Failed to fetch product details");
        router.push("/dashboard/products");
      } finally {
        setIsLoading(false);
      }
    };

    fetchProduct();
  }, [id, router]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
      </div>
    );
  }

  if (!product) return null;

  return (
    <div className="container px-4 py-8 mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          Edit Product
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400 mt-2">
          Update the details of your product.
        </p>
      </div>
      <CreateProductForm initialData={product} />
    </div>
  );
}
