import { HttpClient } from '../http-clients';
import { ApiResponse, Refund } from '@/types';

const httpClient = new HttpClient();

export const refundsApi = {
  // Customer
  requestRefund: (data: { orderId: string; amount: number; reason: string; notes?: string }) => {
    return httpClient.request<ApiResponse<Refund>>('/refunds', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  getMyRefunds: () => {
    return httpClient.request<ApiResponse<Refund[]>>('/refunds/my');
  },

  // Admin
  getAllAdminRefunds: (page = 1, status?: string) => {
    let url = `/refunds/admin/all?page=${page}`;
    if (status) {
      url += `&status=${status}`;
    }
    return httpClient.request<ApiResponse<Refund[]>>(url);
  },

  getRefundDetails: (id: string) => {
    return httpClient.request<ApiResponse<Refund>>(`/refunds/admin/${id}`);
  },

  updateRefundStatus: (id: string, data: { status: 'approved' | 'processed' | 'rejected'; adminNotes?: string; gatewayRefundId?: string }) => {
    return httpClient.request<ApiResponse<Refund>>(`/refunds/admin/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  reconcileRefund: (id: string) => {
    return httpClient.request<ApiResponse<Refund>>(`/refunds/admin/${id}/reconcile`, {
      method: 'POST',
    });
  }
};
