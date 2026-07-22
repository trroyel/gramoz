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

  async calculateCharge(payload: { zoneId: string; deliveryMethod: 'home' | 'branch'; weightKg?: number }) {
    return this.request<ApiResponse<{ charge: number; estimatedDays: string }>>('/courier/calculate', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async trackPackage(code: string): Promise<any> {
    return this.request<any>(`/courier/track/${code}`);
  }
}

export const courierApi = new CourierApi();
