import { HttpClient } from '../http-clients';
import { ApiResponse } from '@/types';

class PaymentsApi extends HttpClient {
  async initiate(orderId: string, method: string = 'sslcommerz'): Promise<ApiResponse<{ gatewayUrl?: string; payment?: any }>> {
    return this.request<ApiResponse<{ gatewayUrl?: string; payment?: any }>>(`/payments/initiate/${orderId}`, {
      method: 'POST',
      body: JSON.stringify({ method }),
    });
  }
}

export const paymentsApi = new PaymentsApi();
