import { CreateProductForm } from "@/components/products/create-product-form";

export const metadata = {
  title: "Create Product | Gramoz",
  description: "Add a new product to your catalog.",
};

export default function NewProductPage() {
  return (
    <div className="container px-4 py-8 mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          Products Management
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400 mt-2">
          Add a new product to your digital storefront.
        </p>
      </div>
      <CreateProductForm />
    </div>
  );
}
