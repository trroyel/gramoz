import { HttpClient } from '../http-clients';
import { ApiResponse } from '@/types';

export interface Division { id: string; name: string; isActive: boolean; }
export interface District { id: string; divisionId: string; name: string; isActive: boolean; }
export interface Zone { id: string; districtId: string; name: string; homeDeliveryCharge: string; branchPickupCharge: string; estimatedDays: string; isActive: boolean; }

export interface RegionsData {
  divisions: Division[];
  districts: District[];
  zones: Zone[];
}

class CourierApi extends HttpClient {
  async getRegions(): Promise<RegionsData> {
    const res = await this.request<RegionsData>('/courier/regions');
    return res;
  }

  async calculateCharge(payload: { zoneId: string; deliveryMethod: 'home' | 'branch'; weightKg?: number }): Promise<{ success: boolean; charge?: number; estimatedDays?: string }> {
    return this.request<{ success: boolean; charge?: number; estimatedDays?: string }>('/courier/calculate', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async trackPackage(code: string): Promise<any> {
    return this.request<any>(`/courier/track/${code}`);
  }

  // --- Admin Methods ---
  async getSettings(): Promise<{ success: boolean; data?: { mode: string; apiKey: string; secretKey: string } }> {
    return this.request('/admin/courier/settings');
  }

  async updateSettings(payload: { mode: string; apiKey: string; secretKey: string }): Promise<ApiResponse> {
    return this.request('/admin/courier/settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  async getAdminZones(): Promise<{ success: boolean; data?: RegionsData }> {
    return this.request('/admin/courier/zones');
  }

  async updateZoneCharge(id: string, payload: { homeDeliveryCharge: string; branchPickupCharge: string }): Promise<ApiResponse> {
    return this.request(`/admin/courier/zones/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }
}

export const courierApi = new CourierApi();
