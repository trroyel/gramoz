import { HttpClient } from '../http-clients';
import { ApiResponse } from '@/types';

class AnalyticsApi extends HttpClient {
  async getDashboardStats(): Promise<ApiResponse<any>> {
    return this.request<ApiResponse<any>>('/analytics/dashboard', {
      method: 'GET',
    });
  }
}

export const analyticsApi = new AnalyticsApi();
