import { Controller, Get, Query, UseGuards, Request } from '@nestjs/common';
import { LoyaltyService } from './loyalty.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('loyalty')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LoyaltyController {
  constructor(private readonly loyaltyService: LoyaltyService) {}

  @Get('balance')
  @Roles('customer')
  async getMyBalance(@Request() req: any) {
    const balance = await this.loyaltyService.getBalance(req.user.id);
    return { success: true, data: { balance } };
  }

  @Get('history')
  @Roles('customer')
  async getMyHistory(@Request() req: any, @Query('page') page: string) {
    const data = await this.loyaltyService.getHistory(req.user.id, parseInt(page) || 1);
    return { success: true, data };
  }
}
