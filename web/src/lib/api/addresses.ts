import { HttpClient } from '../http-clients';
import { Address } from '@/types';

export interface CreateAddressDto {
  title: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  zipCode?: string;
  isDefault?: boolean;
}

export interface UpdateAddressDto extends Partial<CreateAddressDto> {}

class AddressesApiClient extends HttpClient {
  async getAddresses(): Promise<{ success: boolean; data?: Address[] }> {
    return this.request('/addresses');
  }

  async createAddress(data: CreateAddressDto): Promise<{ success: boolean; data?: Address }> {
    return this.request('/addresses', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateAddress(id: string, data: UpdateAddressDto): Promise<{ success: boolean; data?: Address }> {
    return this.request(`/addresses/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteAddress(id: string): Promise<{ success: boolean }> {
    return this.request(`/addresses/${id}`, {
      method: 'DELETE',
    });
  }

  async setDefaultAddress(id: string): Promise<{ success: boolean; data?: Address }> {
    return this.request(`/addresses/${id}/default`, {
      method: 'PUT',
    });
  }
}

export const addressesApi = new AddressesApiClient();
