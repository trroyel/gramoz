import { HttpClient } from '../http-clients';
import { ApiResponse, Category } from '@/types';

class CategoriesApi extends HttpClient {
  async getAll(): Promise<{ success: boolean; data?: Category[] }> {
    return this.request('/categories');
  }

  async getOne(id: string): Promise<{ success: boolean; data?: Category }> {
    return this.request(`/categories/${id}`);
  }

  async create(data: { name: string; description?: string }): Promise<{ success: boolean; data?: Category }> {
    return this.request('/categories', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async update(id: string, data: { name?: string; description?: string }): Promise<{ success: boolean; data?: Category }> {
    return this.request(`/categories/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async delete(id: string): Promise<{ success: boolean }> {
    return this.request(`/categories/${id}`, {
      method: 'DELETE',
    });
  }
}

export const categoriesApi = new CategoriesApi();
