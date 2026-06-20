import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  HttpStatus,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { RefundsService } from './refunds.service';
import type { RequestRefundDto, ProcessRefundDto } from './refunds.service';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@modules/auth/guards/roles.guard';
import { Roles } from '@modules/auth/decorators/roles.decorator';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { Role } from '@database/schema';
import type { User } from '@database/schema';

@Controller('refunds')
@UseGuards(JwtAuthGuard)
export class RefundsController {
  constructor(private readonly refundsService: RefundsService) {}

  // ─── Customer routes ─────────────────────────────────────────────────────

  /**
   * POST /refunds
   * Customer submits a refund request for a delivered order.
   */
  @Post()
  async requestRefund(
    @CurrentUser() user: User,
    @Body() body: RequestRefundDto,
    @Res() res: FastifyReply,
  ) {
    const refund = await this.refundsService.requestRefund(user.id, body);
    return res.status(HttpStatus.CREATED).send({
      success: true,
      message:
        'Refund request submitted. Our team will review it within 2-3 business days.',
      data: refund,
    });
  }

  /**
   * GET /refunds/my
   * Customer views their own refund history.
   */
  @Get('my')
  async getMyRefunds(@CurrentUser() user: User, @Res() res: FastifyReply) {
    const refunds = await this.refundsService.getMyRefunds(user.id);
    return res.send({ success: true, data: refunds });
  }

  // ─── Admin routes ─────────────────────────────────────────────────────────

  /**
   * GET /refunds
   * Admin lists all refund requests, optionally filtered by status.
   * Query params: status, page, limit
   */
  @Get('admin/all')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  async getAllRefunds(
    @Query('status') status: string,
    @Query('page') page: string,
    @Query('limit') limit: string,
    @Res() res: FastifyReply,
  ) {
    const refunds = await this.refundsService.getAllRefunds(
      status as any,
      parseInt(page ?? '1', 10),
      parseInt(limit ?? '20', 10),
    );
    return res.send({ success: true, data: refunds });
  }

  /**
   * GET /refunds/:id
   * Admin views a single refund in detail.
   */
  @Get('admin/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  async getRefundDetails(@Param('id') id: string, @Res() res: FastifyReply) {
    const refund = await this.refundsService.getRefundById(id);
    return res.send({ success: true, data: refund });
  }

  /**
   * PATCH /refunds/:id
   * Admin approves, processes, or rejects a refund.
   * Body: { status, adminNotes?, gatewayRefundId? }
   */
  @Patch('admin/:id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  async updateRefundStatus(
    @CurrentUser() admin: User,
    @Param('id') id: string,
    @Body() body: ProcessRefundDto,
    @Res() res: FastifyReply,
  ) {
    const refund = await this.refundsService.processRefund(admin.id, id, body);
    return res.send({
      success: true,
      message: `Refund ${body.status} successfully`,
      data: refund,
    });
  }
}
