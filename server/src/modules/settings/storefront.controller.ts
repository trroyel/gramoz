import { Controller, Get } from '@nestjs/common';
import { SettingsService } from './settings.service';

@Controller('storefront')
export class StorefrontController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  async getStorefrontConfig() {
    const config = await this.settingsService.getStorefrontConfig();
    return { success: true, data: config };
  }
}
