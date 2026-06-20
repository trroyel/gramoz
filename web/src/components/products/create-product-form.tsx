"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, PackagePlus, Image as ImageIcon, Save } from "lucide-react";
import { productsApi } from "@/lib/api/products";
import { CreateProductData, Product } from "@/types";
import { useCategories } from "@/hooks/queries/use-categories";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface ProductFormProps {
  initialData?: Product;
}

const getImageUrl = (urlOrObj?: string | { url?: string } | any) => {
  if (!urlOrObj) return "";
  
  const url = typeof urlOrObj === 'string' ? urlOrObj : urlOrObj?.url;
  
  if (!url || typeof url !== 'string') return "";
  if (url.startsWith('http')) return url;
  
  const safeUrl = url.startsWith('/uploads') ? `/public${url}` : url;
  return safeUrl;
};

export function CreateProductForm({ initialData }: ProductFormProps) {
  const router = useRouter();
  const isEditMode = !!initialData;
  const { data: categories = [], isLoading: categoriesLoading } = useCategories();
  
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState<Partial<CreateProductData>>({
    name: initialData?.name || "",
    description: initialData?.description || "",
    price: initialData?.price ? Number(initialData.price) : 0,
    stock: initialData?.stock || 0,
    unit: initialData?.unit || "piece",
    categoryId: initialData?.categoryId || "",
  });
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(
    initialData?.images?.[0] ? getImageUrl(initialData.images[0]) : null
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (initialData) {
      setFormData({
        name: initialData.name || "",
        description: initialData.description || "",
        price: initialData.price ? Number(initialData.price) : 0,
        stock: initialData.stock || 0,
        unit: initialData.unit || "piece",
        categoryId: initialData.categoryId || "",
      });
      setImagePreview(initialData.images?.[0] ? getImageUrl(initialData.images[0]) : null);
    }
  }, [initialData]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === "number" ? Number(value) : value,
    }));
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.name || formData.price === undefined || formData.stock === undefined) {
      toast.error("Please fill all required fields");
      return;
    }

    setIsLoading(true);
    try {
      const dataToSubmit: CreateProductData = {
        name: formData.name,
        price: formData.price,
        stock: formData.stock,
        unit: formData.unit,
        categoryId: formData.categoryId,
        description: formData.description,
        images: imageFile ? [imageFile] : undefined,
      };

      if (isEditMode && initialData?.id) {
        const response = await productsApi.update(initialData.id, dataToSubmit);
        if (response.success) {
          toast.success("Product updated successfully!");
          router.push("/admin/products");
        } else {
          toast.error("Failed to update product", {
            description: response.message,
          });
        }
      } else {
        const response = await productsApi.create(dataToSubmit);
        
        if (response.success) {
          toast.success("Product created successfully!");
          router.push("/admin/products");
        } else {
          toast.error("Failed to create product", {
            description: response.message,
          });
        }
      }
    } catch (error: any) {
      toast.error(isEditMode ? "Error updating product" : "Error creating product", {
        description: error?.message || "An unexpected error occurred.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-4xl mx-auto border-0 shadow-lg dark:bg-zinc-900/50 mt-6">
      <CardHeader className="space-y-2 pb-6">
        <div className="flex items-center space-x-3">
          <div className="w-12 h-12 rounded-xl bg-orange-100 dark:bg-orange-900/20 flex items-center justify-center">
            {isEditMode ? <Save className="w-6 h-6 text-orange-500" /> : <PackagePlus className="w-6 h-6 text-orange-500" />}
          </div>
          <div>
            <CardTitle className="text-2xl font-bold tracking-tight">
              {isEditMode ? "Edit Product" : "Create Product"}
            </CardTitle>
            <CardDescription>
              {isEditMode ? "Update the product details below" : "Add a new product to your catalog"}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="name">Product Name *</Label>
                <Input
                  id="name"
                  name="name"
                  placeholder="e.g. Premium Rajshahi Silk Sari"
                  value={formData.name}
                  onChange={handleChange}
                  disabled={isLoading}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="categoryId">Category *</Label>
                {categoriesLoading ? (
                  <select disabled className="flex h-10 w-full rounded-md border border-input bg-muted px-3 py-2 text-sm text-muted-foreground ring-offset-background">
                    <option>Loading categories...</option>
                  </select>
                ) : (
                  <select
                    id="categoryId"
                    name="categoryId"
                    value={formData.categoryId || ""}
                    onChange={handleChange}
                    disabled={isLoading}
                    required
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="" disabled>Select a category</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="price">Price (৳) *</Label>
                  <Input
                    id="price"
                    name="price"
                    type="number"
                    min="0"
                    placeholder="0.00"
                    value={formData.price}
                    onChange={handleChange}
                    disabled={isLoading}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="stock">Stock Quantity *</Label>
                  <Input
                    id="stock"
                    name="stock"
                    type="number"
                    min="0"
                    placeholder="0"
                    value={formData.stock}
                    onChange={handleChange}
                    disabled={isLoading}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="unit">Unit *</Label>
                  <select
                    id="unit"
                    name="unit"
                    value={formData.unit || "piece"}
                    onChange={handleChange}
                    disabled={isLoading}
                    required
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="piece">Piece</option>
                    <option value="kg">KG</option>
                    <option value="g">Gram</option>
                    <option value="liter">Liter</option>
                    <option value="ml">ML</option>
                    <option value="dozen">Dozen</option>
                    <option value="meter">Meter</option>
                    <option value="pack">Pack</option>
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  name="description"
                  placeholder="Describe your product..."
                  value={formData.description}
                  onChange={handleChange}
                  disabled={isLoading}
                  rows={5}
                />
              </div>
            </div>

            <div className="space-y-2 flex flex-col h-full">
              <Label>Product Image</Label>
              <div 
                className="border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl p-4 flex flex-col items-center justify-center flex-1 min-h-[300px] cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                {imagePreview ? (
                  <div className="relative w-full h-full rounded-lg overflow-hidden">
                    <img src={imagePreview} alt="Preview" className="absolute inset-0 w-full h-full object-cover" />
                  </div>
                ) : (
                  <div className="text-center space-y-2">
                    <div className="mx-auto w-12 h-12 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                      <ImageIcon className="w-6 h-6 text-zinc-500" />
                    </div>
                    <div className="text-sm text-zinc-600 dark:text-zinc-400">
                      <span className="font-semibold text-orange-500">Click to upload</span> or drag and drop
                    </div>
                    <div className="text-xs text-zinc-500">SVG, PNG, JPG or GIF (max. 800x400px)</div>
                  </div>
                )}
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  accept="image/*"
                  onChange={handleImageChange}
                  disabled={isLoading}
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-4 pt-6 border-t border-zinc-100 dark:border-zinc-800">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.back()}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button type="submit" className="bg-orange-500 hover:bg-orange-600 text-white" disabled={isLoading}>
              {isLoading ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : isEditMode ? (
                <Save className="w-4 h-4 mr-2" />
              ) : (
                <PackagePlus className="w-4 h-4 mr-2" />
              )}
              {isEditMode ? "Save Changes" : "Create Product"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
