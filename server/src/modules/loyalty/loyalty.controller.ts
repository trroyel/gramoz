import { Controller, Get, Query, UseGuards, Request } from '@nestjs/common';
import { LoyaltyService } from './loyalty.service';
import { SettingsService } from '../settings/settings.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('loyalty')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LoyaltyController {
  constructor(
    private readonly loyaltyService: LoyaltyService,
    private readonly settingsService: SettingsService
  ) {}

  @Get('balance')
  @Roles('customer')
  async getMyBalance(@Request() req: any) {
    const balance = await this.loyaltyService.getBalance(req.user.id);
    const ratio = await this.settingsService.getPointsToCurrencyRatio();
    const currencyValue = balance / ratio;
    return { success: true, data: { balance, currencyValue, ratio } };
  }

  @Get('history')
  @Roles('customer')
  async getMyHistory(@Request() req: any, @Query('page') page: string) {
    const data = await this.loyaltyService.getHistory(req.user.id, parseInt(page) || 1);
    return { success: true, data };
  }
}
