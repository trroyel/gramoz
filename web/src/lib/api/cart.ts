import { HttpClient } from '../http-clients';
import { ApiResponse, Cart } from '@/types';

class CartApi extends HttpClient {
  async getCart(): Promise<ApiResponse<Cart>> {
    return this.request<ApiResponse<Cart>>('/cart');
  }

  async addItem(productId: string, quantity: number): Promise<ApiResponse<any>> {
    return this.request<ApiResponse<any>>('/cart/items', {
      method: 'POST',
      body: JSON.stringify({ productId, quantity }),
    });
  }

  async updateItem(itemId: string, quantity: number): Promise<ApiResponse<any>> {
    return this.request<ApiResponse<any>>(`/cart/items/${itemId}`, {
      method: 'PUT',
      body: JSON.stringify({ quantity }),
    });
  }

  async removeItem(itemId: string): Promise<ApiResponse<any>> {
    return this.request<ApiResponse<any>>(`/cart/items/${itemId}`, {
      method: 'DELETE',
    });
  }

  async clearCart(): Promise<ApiResponse<any>> {
    return this.request<ApiResponse<any>>('/cart', {
      method: 'DELETE',
    });
  }
}

export const cartApi = new CartApi();
