import { HttpClient } from '../http-clients';
import { ApiResponse, Wishlist } from '@/types';

const httpClient = new HttpClient();

export const wishlistsApi = {
  add: (productId: string) => {
    return httpClient.request<ApiResponse<null>>(`/wishlists/${productId}`, { method: 'POST' });
  },
  
  remove: (productId: string) => {
    return httpClient.request<ApiResponse<null>>(`/wishlists/${productId}`, { method: 'DELETE' });
  },

  getAll: () => {
    return httpClient.request<ApiResponse<Wishlist[]>>('/wishlists', { method: 'GET' });
  },

  check: (productId: string) => {
    return httpClient.request<ApiResponse<{ isFavorited: boolean }>>(`/wishlists/check/${productId}`, { method: 'GET' });
  }
};
