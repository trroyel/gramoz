import { HttpClient, API_BASE_URL } from '../http-clients';
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
  },

  getStorefront: () => {
    return httpClient.request<ApiResponse<any>>('/storefront', { method: 'GET' });
  },

  updateStorefront: (data: { hero?: any; promo?: any }) => {
    return httpClient.request<ApiResponse<null>>('/admin/settings/storefront', {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  },

  uploadImage: async (file: File) => {
    const formData = new FormData();
    formData.append('image', file);

    const DIRECT_API_URL =
      (typeof window !== 'undefined' && process.env.NEXT_PUBLIC_SERVER_URL)
        ? `${process.env.NEXT_PUBLIC_SERVER_URL}/api/v1`
        : API_BASE_URL;

    const url = `${DIRECT_API_URL}/admin/settings/upload-image`;
    const response = await fetch(url, {
      method: 'POST',
      body: formData,
      credentials: 'include',
    });

    const rawText = await response.text();
    let data: any;
    try {
      data = JSON.parse(rawText);
    } catch {
      throw new Error(rawText || `HTTP ${response.status}`);
    }

    if (!response.ok) {
      throw new Error(data?.error?.message || data?.message || `HTTP ${response.status}`);
    }

    return data as { success: boolean; url: string; message?: string };
  }
};
