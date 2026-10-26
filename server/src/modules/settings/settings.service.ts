import { Injectable } from '@nestjs/common';
import { SettingsStore } from './settings.store';

@Injectable()
export class SettingsService {
  constructor(private readonly settingsStore: SettingsStore) {}

  async getSetting(key: string, defaultValue: string): Promise<string> {
    const value = await this.settingsStore.getSetting(key);
    return value !== null ? value : defaultValue;
  }

  async getIntSetting(key: string, defaultValue: number): Promise<number> {
    const value = await this.settingsStore.getSetting(key);
    if (value === null) return defaultValue;
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? defaultValue : parsed;
  }

  async setSetting(
    key: string,
    value: string,
    description?: string,
  ): Promise<void> {
    await this.settingsStore.setSetting(key, value, description);
  }

  async getAllSettings() {
    return this.settingsStore.getAllSettings();
  }

  // Domain specific getters
  async getTextReviewPoints(): Promise<number> {
    return this.getIntSetting('LOYALTY_POINTS_TEXT_REVIEW', 50);
  }

  async getMediaReviewPoints(): Promise<number> {
    return this.getIntSetting('LOYALTY_POINTS_MEDIA_REVIEW', 100);
  }

  async getPointsValidityDays(): Promise<number> {
    return this.getIntSetting('LOYALTY_POINTS_VALIDITY_DAYS', 365);
  }

  async getPointsToCurrencyRatio(): Promise<number> {
    // e.g., 100 points = 1.00 local currency
    return this.getIntSetting('LOYALTY_POINTS_TO_CURRENCY_RATIO', 100);
  }

  async getAbandonedCartIdleHours(): Promise<number> {
    return this.getIntSetting('ABANDONED_CART_IDLE_HOURS', 24);
  }

  async getCheckoutExpiryMinutes(): Promise<number> {
    return this.getIntSetting('CHECKOUT_EXPIRY_MINUTES', 30);
  }

  // --- Storefront CMS ---
  async getStorefrontConfig() {
    const heroStr = await this.getSetting('STOREFRONT_HERO', '{}');
    const promoStr = await this.getSetting('STOREFRONT_PROMO', '{}');

    try {
      return {
        hero: JSON.parse(heroStr),
        promo: JSON.parse(promoStr),
      };
    } catch {
      return { hero: {}, promo: {} };
    }
  }

  async updateStorefrontConfig(payload: { hero?: any; promo?: any }) {
    if (payload.hero) {
      await this.setSetting(
        'STOREFRONT_HERO',
        JSON.stringify(payload.hero),
        'Homepage Hero Section Configuration',
      );
    }
    if (payload.promo) {
      await this.setSetting(
        'STOREFRONT_PROMO',
        JSON.stringify(payload.promo),
        'Homepage Promo Section Configuration',
      );
    }
  }
}
