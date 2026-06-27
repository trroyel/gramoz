import { HttpClient, API_BASE_URL } from '../http-clients';
import type { ApiResponse, Product, CreateProductData } from '@/types';

const httpClient = new HttpClient();

// Next.js rewrites() can't stream multipart/form-data bodies — they get buffered
// and corrupted in transit, causing 500s on the backend. For FormData requests
// (file uploads) we bypass the proxy and go directly to the backend server.
// NEXT_PUBLIC_SERVER_URL=http://localhost:5000 in .env.local
const DIRECT_API_URL =
  (typeof window !== 'undefined' && process.env.NEXT_PUBLIC_SERVER_URL)
    ? `${process.env.NEXT_PUBLIC_SERVER_URL}/api/v1`
    : API_BASE_URL;

async function multipartRequest<T>(path: string, method: string, formData: FormData): Promise<T> {
  const url = `${DIRECT_API_URL}${path}`;
  const response = await fetch(url, {
    method,
    body: formData,
    credentials: 'include',
  });

  const rawText = await response.text();
  let data: any;
  try {
    data = JSON.parse(rawText);
  } catch {
    throw new Error(rawText || `HTTP ${response.status}`);
  }

  if (!response.ok) {
    throw new Error(data?.error?.message || data?.message || `HTTP ${response.status}`);
  }

  return data as T;
}

export const productsApi = {
  create: (data: CreateProductData) => {
    const formData = new FormData();
    formData.append('name', data.name);
    formData.append('price', data.price.toString());
    formData.append('stock', data.stock.toString());

    if (data.categoryId) formData.append('categoryId', data.categoryId);
    if (data.unit) formData.append('unit', data.unit);
    if (data.description) formData.append('description', data.description);
    if (data.images && data.images.length > 0) formData.append('image', data.images[0]);

    return multipartRequest<ApiResponse<Product>>('/products', 'POST', formData);
  },

  getAll: (params?: Record<string, string>) => {
    const qs = params ? new URLSearchParams(params).toString() : '';
    return httpClient.request<ApiResponse<Product[]>>(`/products${qs ? `?${qs}` : ''}`, {
      method: 'GET',
    });
  },

  getById: (id: string) =>
    httpClient.request<ApiResponse<Product>>(`/products/${id}`, {
      method: 'GET',
    }),

  update: (id: string, data: Partial<CreateProductData>) => {
    const formData = new FormData();
    if (data.name) formData.append('name', data.name);
    if (data.price !== undefined) formData.append('price', data.price.toString());
    if (data.stock !== undefined) formData.append('stock', data.stock.toString());
    if (data.categoryId) formData.append('categoryId', data.categoryId);
    if (data.unit) formData.append('unit', data.unit);
    if (data.description) formData.append('description', data.description);
    if (data.images && data.images.length > 0) formData.append('image', data.images[0]);

    return multipartRequest<ApiResponse<Product>>(`/products/${id}`, 'PUT', formData);
  },

  delete: (id: string) =>
    httpClient.request<ApiResponse<null>>(`/products/${id}`, {
      method: 'DELETE',
    }),
};

