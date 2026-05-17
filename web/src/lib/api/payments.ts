import { HttpClient } from '../http-clients';
import { ApiResponse } from '@/types';

class PaymentsApi extends HttpClient {
  async initiate(orderId: string): Promise<ApiResponse<{ gatewayUrl: string }>> {
    return this.request<ApiResponse<{ gatewayUrl: string }>>(`/payments/initiate/${orderId}`, {
      method: 'POST',
    });
  }
}

export const paymentsApi = new PaymentsApi();
