import { Controller, Get, Param, Res, Post, Body } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { CourierService } from './courier.service';

@Controller('courier')
export class CourierController {
  constructor(private readonly courierService: CourierService) {}

  @Get('track/:code')
  async trackPackage(@Param('code') code: string, @Res() res: FastifyReply) {
    const trackingInfo = await this.courierService.trackConsignment(code);
    return res.send(trackingInfo);
  }

  @Get('regions')
  async getRegions(@Res() res: FastifyReply) {
    const regions = await this.courierService.getRegions();
    return res.send(regions);
  }

  @Post('calculate')
  async calculateCharge(
    @Body()
    body: {
      zoneId: string;
      deliveryMethod: 'home' | 'branch';
      weightKg?: number;
    },
    @Res() res: FastifyReply,
  ) {
    try {
      if (!body || !body.zoneId) {
        return res
          .status(400)
          .send({ success: false, message: 'zoneId is required' });
      }
      const result = await this.courierService.calculateCharge(
        body.zoneId,
        body.deliveryMethod,
        body.weightKg,
      );
      return res.send({ success: true, ...result });
    } catch (e: any) {
      return res.status(400).send({ success: false, message: e.message });
    }
  }
}
