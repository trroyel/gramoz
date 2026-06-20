import { Controller, Post, Get, Body, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PromosService } from '../../promos.service';
import { ValidatePromoDto } from '../../dto/validate-promo.dto';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';

@Controller('promos')
export class PromosController {
  constructor(private readonly promosService: PromosService) {}

  /**
   * GET /promos
   * Returns all active, non-expired promos for the public offers page.
   * No authentication required.
   */
  @Get()
  @SkipThrottle()
  async getActivePromos() {
    const promos = await this.promosService.findPublicActive();
    return { success: true, data: promos };
  }

  @Post('validate')
  @UseGuards(JwtAuthGuard)
  async validatePromo(@Body() dto: ValidatePromoDto) {
    const result = await this.promosService.validate(dto);
    return {
      success: true,
      data: result,
    };
  }
}
