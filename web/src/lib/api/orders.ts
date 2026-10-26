import { HttpClient, API_BASE_URL } from '../http-clients';
import { ApiResponse, Order } from '@/types';

class OrdersApi extends HttpClient {
  async checkout(payload: {
    addressLine1: string;
    city: string;
    phone: string;
    promoCode?: string | null;
    usePoints?: boolean;
    latitude?: string;
    longitude?: string;
    zoneId?: string;
    deliveryMethod?: 'home' | 'branch';
    idempotencyKey?: string;
  }): Promise<ApiResponse<Order>> {
    const headers: Record<string, string> = {};
    if (payload.idempotencyKey) {
      headers['Idempotency-Key'] = payload.idempotencyKey;
    }
    return this.request<ApiResponse<Order>>('/orders/checkout', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
  }

  async getOrders(): Promise<ApiResponse<Order[]>> {
    return this.request<ApiResponse<Order[]>>('/orders');
  }

  async getOrder(id: string): Promise<ApiResponse<Order>> {
    return this.request<ApiResponse<Order>>(`/orders/${id}`);
  }

  async cancelOrder(id: string, reason?: string): Promise<ApiResponse<Order>> {
    return this.request<ApiResponse<Order>>(`/orders/${id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  async getAllAsAdmin(): Promise<ApiResponse<Record<string, any>[]>> {
    return this.request<ApiResponse<Record<string, any>[]>>('/orders/admin/all', {
      method: 'GET',
    });
  }

  async getAdminOrder(id: string): Promise<ApiResponse<Record<string, any>>> {
    return this.request<ApiResponse<Record<string, any>>>(`/orders/admin/${id}`, {
      method: 'GET',
    });
  }

  async updateStatus(id: string, status: string): Promise<ApiResponse<Record<string, any>>> {
    return this.request<ApiResponse<Record<string, any>>>(`/orders/admin/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  }

  async downloadInvoice(orderId: string, isAdmin = false): Promise<void> {
    const endpoint = isAdmin ? `/orders/admin/${orderId}/invoice` : `/orders/${orderId}/invoice`;
    const url = `${API_BASE_URL}${endpoint}`;
    
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error('Failed to download invoice');
    }

    const blob = await response.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `Invoice-${orderId.slice(0, 8).toUpperCase()}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(downloadUrl);
  }
}

export const ordersApi = new OrdersApi();
