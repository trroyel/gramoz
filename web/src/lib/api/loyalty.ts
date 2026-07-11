import { HttpClient } from '../http-clients';
import { ApiResponse, LoyaltyPoint } from '@/types';

const httpClient = new HttpClient();

export const loyaltyApi = {
  getMyBalance: () => {
    return httpClient.request<ApiResponse<{ balance: number }>>('/loyalty/balance', { method: 'GET' });
  },
  
  getMyHistory: (page = 1) => {
    return httpClient.request<ApiResponse<LoyaltyPoint[]>>(`/loyalty/history?page=${page}`, { method: 'GET' });
  }
};
