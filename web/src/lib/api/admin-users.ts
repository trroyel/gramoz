import { HttpClient } from '../http-clients';
import { ApiResponse, PaginatedResponse } from '@/types';

export interface AdminUser {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  role: string;
  status: string;
  isEmailVerified: boolean;
  isPhoneVerified: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  totalOrders: number;
  totalSpending: number;
}

export interface GetUsersQuery {
  page?: number;
  limit?: number;
  query?: string;
  role?: string;
  status?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

class AdminUsersApi extends HttpClient {
  async getUsers(params?: GetUsersQuery): Promise<PaginatedResponse<AdminUser>> {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== '') {
          searchParams.append(key, String(value));
        }
      });
    }

    return this.request<PaginatedResponse<AdminUser>>(`/admin/users?${searchParams.toString()}`, {
      method: 'GET',
    });
  }

  async getUserDetails(id: string): Promise<ApiResponse<AdminUser>> {
    return this.request<ApiResponse<AdminUser>>(`/admin/users/${id}`, {
      method: 'GET',
    });
  }

  async updateRole(id: string, role: string): Promise<ApiResponse<AdminUser>> {
    return this.request<ApiResponse<AdminUser>>(`/admin/users/${id}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    });
  }

  async updateStatus(id: string, status: string): Promise<ApiResponse<AdminUser>> {
    return this.request<ApiResponse<AdminUser>>(`/admin/users/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  }

  async getUserOrders(id: string): Promise<ApiResponse<any[]>> {
    return this.request<ApiResponse<any[]>>(`/admin/users/${id}/orders`, {
      method: 'GET',
    });
  }
}

export const adminUsersApi = new AdminUsersApi();
