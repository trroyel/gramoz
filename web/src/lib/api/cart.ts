import { HttpClient } from '../http-clients';
import { ApiResponse, Cart, CartItem } from '@/types';

class CartApi extends HttpClient {
  async getCart(): Promise<ApiResponse<Cart>> {
    return this.request<ApiResponse<Cart>>('/cart');
  }

  async addItem(
    productId: string,
    quantity: number,
    variantId?: string,
  ): Promise<ApiResponse<CartItem>> {
    return this.request<ApiResponse<CartItem>>('/cart/items', {
      method: 'POST',
      body: JSON.stringify({ productId, quantity, variantId }),
    });
  }

  async updateItem(
    itemId: string,
    quantity: number,
  ): Promise<ApiResponse<CartItem>> {
    return this.request<ApiResponse<CartItem>>(`/cart/items/${itemId}`, {
      method: 'PUT',
      body: JSON.stringify({ quantity }),
    });
  }

  async removeItem(itemId: string): Promise<ApiResponse<{ message: string }>> {
    return this.request<ApiResponse<{ message: string }>>(
      `/cart/items/${itemId}`,
      {
        method: 'DELETE',
      },
    );
  }

  async clearCart(): Promise<ApiResponse<{ message: string }>> {
    return this.request<ApiResponse<{ message: string }>>('/cart', {
      method: 'DELETE',
    });
  }
}

export const cartApi = new CartApi();
