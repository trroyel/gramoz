import { HttpClient } from '../http-clients';
import type { ApiResponse, Product, CreateProductData } from '@/types';

const httpClient = new HttpClient();

export const productsApi = {
  create: (data: CreateProductData) => {
    const formData = new FormData();
    formData.append('name', data.name);
    formData.append('price', data.price.toString());
    formData.append('stock', data.stock.toString());
    
    if (data.description) {
      formData.append('description', data.description);
    }
    
    if (data.images && data.images.length > 0) {
      formData.append('image', data.images[0]);
    }

    return httpClient.request<ApiResponse<Product>>('/products', {
      method: 'POST',
      body: formData,
    });
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
    
    if (data.description) {
      formData.append('description', data.description);
    }
    
    if (data.images && data.images.length > 0) {
      formData.append('image', data.images[0]);
    }

    return httpClient.request<ApiResponse<Product>>(`/products/${id}`, {
      method: 'PUT',
      body: formData,
    });
  },

  delete: (id: string) =>
    httpClient.request<ApiResponse<null>>(`/products/${id}`, {
      method: 'DELETE',
    }),
};
