import { HttpClient } from '../http-clients';
import { ApiResponse, Category } from '@/types';

class CategoriesApi extends HttpClient {
  async getAll(): Promise<ApiResponse<Category[]>> {
    return this.request<ApiResponse<Category[]>>('/categories');
  }

  async getOne(id: string): Promise<ApiResponse<Category>> {
    return this.request<ApiResponse<Category>>(`/categories/${id}`);
  }
}

export const categoriesApi = new CategoriesApi();
