import { Controller, Get, Put, Body, UseGuards } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('admin/settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('super_admin', 'admin')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  async getAllSettings() {
    const data = await this.settingsService.getAllSettings();
    return { success: true, data };
  }

  @Put()
  async updateSetting(
    @Body() body: { key: string; value: string; description?: string },
  ) {
    await this.settingsService.setSetting(
      body.key,
      body.value,
      body.description,
    );
    return { success: true, message: 'Setting updated successfully' };
  }
}
