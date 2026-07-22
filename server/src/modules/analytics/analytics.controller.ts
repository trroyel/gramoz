import { Controller, Get, UseGuards } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@modules/auth/guards/roles.guard';
import { Roles } from '@modules/auth/decorators/roles.decorator';
import { PLATFORM_ROLES } from '@database/schema/enums';

@Controller('analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...PLATFORM_ROLES)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('dashboard')
  async getDashboardStats() {
    const data = await this.analyticsService.getDashboardStats();
    return {
      success: true,
      data,
    };
  }
}
