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

  async setSetting(key: string, value: string, description?: string): Promise<void> {
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
}
