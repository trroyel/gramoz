import { HttpClient } from '../http-clients';
import { ApiResponse, Setting } from '@/types';

const httpClient = new HttpClient();

export const settingsApi = {
  getAllSettings: () => {
    return httpClient.request<ApiResponse<Setting[]>>('/admin/settings', { method: 'GET' });
  },
  
  updateSetting: (data: { key: string; value: string; description?: string }) => {
    return httpClient.request<ApiResponse<null>>('/admin/settings', {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  }
};
