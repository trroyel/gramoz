import { HttpClient } from '../http-clients';
import { ApiResponse, Order } from '@/types';

class OrdersApi extends HttpClient {
  async checkout(payload: { addressLine1: string; city: string; phone: string }): Promise<ApiResponse<Order>> {
    return this.request<ApiResponse<Order>>('/orders/checkout', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async getOrders(): Promise<ApiResponse<Order[]>> {
    return this.request<ApiResponse<Order[]>>('/orders');
  }

  async getOrder(id: string): Promise<ApiResponse<Order>> {
    return this.request<ApiResponse<Order>>(`/orders/${id}`);
  }

  async getAllAsAdmin(): Promise<ApiResponse<any[]>> {
    return this.request<ApiResponse<any[]>>('/orders/admin/all', {
      method: 'GET',
    });
  }

  async getAdminOrder(id: string): Promise<ApiResponse<any>> {
    return this.request<ApiResponse<any>>(`/orders/admin/${id}`, {
      method: 'GET',
    });
  }

  async updateStatus(id: string, status: string): Promise<ApiResponse<any>> {
    return this.request<ApiResponse<any>>(`/orders/admin/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  }
}

export const ordersApi = new OrdersApi();
