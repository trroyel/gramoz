import { HttpClient } from '../http-clients';

export interface Promo {
  id: string;
  code: string;
  discountType: 'percentage' | 'fixed';
  discountValue: string;
  minOrderValue: string | null;
  maxUses: number | null;
  currentUses: number;
  expiresAt: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePromoDto {
  code: string;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
  minOrderValue?: number;
  maxUses?: number;
  expiresAt?: string;
  isActive?: boolean;
}

export interface ValidatePromoDto {
  code: string;
  subtotal: number;
}

export interface ValidatedPromo {
  promoId: string;
  code: string;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
  discountAmount: number;
}

class PromosApiClient extends HttpClient {
  // Admin Methods
  async getAllPromos(): Promise<Promo[]> {
    const res = await this.request<{ success: boolean; data: Promo[] }>('/admin/promos');
    return res.data;
  }

  async createPromo(data: CreatePromoDto): Promise<Promo> {
    const res = await this.request<{ success: boolean; data: Promo }>('/admin/promos', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return res.data;
  }

  async togglePromoActive(id: string): Promise<Promo> {
    const res = await this.request<{ success: boolean; data: Promo }>(`/admin/promos/${id}/toggle`, {
      method: 'PUT',
    });
    return res.data;
  }

  async deletePromo(id: string): Promise<void> {
    await this.request(`/admin/promos/${id}`, {
      method: 'DELETE',
    });
  }

  // Customer Methods
  async getPublicPromos(): Promise<{ success: boolean; data: Promo[] }> {
    return this.request<{ success: boolean; data: Promo[] }>('/promos');
  }

  async validatePromo(data: ValidatePromoDto): Promise<ValidatedPromo> {
    const res = await this.request<{ success: boolean; data: ValidatedPromo }>('/promos/validate', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return res.data;
  }
}

export const promosApi = new PromosApiClient();
