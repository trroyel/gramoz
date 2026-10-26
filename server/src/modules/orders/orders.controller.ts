/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Patch,
  ParseUUIDPipe,
  Res,
  Headers,
  ForbiddenException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { FastifyReply } from 'fastify';

import { OrdersService } from './orders.service';
import { InvoicesService } from './invoices.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { Roles } from '@modules/auth/decorators/roles.decorator';
import { RolesGuard } from '@modules/auth/guards/roles.guard';
import { PLATFORM_ROLES } from '@database/schema/enums';
import type { User } from '@database/schema';

@UseGuards(JwtAuthGuard)
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly invoicesService: InvoicesService,
  ) {}

  // Tight limit — checkout hits DB, stock, inventory, and external email on every call.
  // 5 per minute per IP is enough for any real user; stops abuse and double-submit spam.
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('checkout')
  async checkout(
    @CurrentUser() user: User,
    @Body() dto: CreateOrderDto,
    @Headers('idempotency-key') idempotencyKeyHeader?: string,
  ) {
    if (!user.isPhoneVerified) {
      throw new ForbiddenException(
        'Phone number verification is required to place an order.',
      );
    }

    const idempotencyKey = idempotencyKeyHeader || dto.idempotencyKey;
    const order = await this.ordersService.createOrderFromCart(
      user.id,
      dto,
      idempotencyKey,
    );
    return {
      success: true,
      message: 'Order created successfully',
      data: order,
    };
  }

  @Get()
  async getUserOrders(@CurrentUser() user: User) {
    const orders = await this.ordersService.getUserOrders(user.id);
    return orders;
  }

  @Get(':id')
  async getOrderDetails(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const orderDetails = await this.ordersService.getOrderDetails(user.id, id);
    return orderDetails;
  }

  @Get(':id/invoice')
  async downloadInvoice(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: FastifyReply,
  ) {
    // Validate order belongs to user
    await this.ordersService.getOrderDetails(user.id, id);
    await this.invoicesService.generateInvoicePdf(id, res);
  }

  @Post(':id/cancel')
  async cancelOrder(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body('reason') reason?: string,
  ) {
    const order = await this.ordersService.cancelOrder(user.id, id, reason);
    return {
      success: true,
      message: 'Order cancelled successfully',
      data: order,
    };
  }

  @Get('admin/all')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...PLATFORM_ROLES)
  async getAllOrdersAsAdmin() {
    const orders = await this.ordersService.getAllOrdersAsAdmin();
    return orders;
  }

  @Get('admin/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...PLATFORM_ROLES)
  async getOrderDetailsAsAdmin(@Param('id', ParseUUIDPipe) id: string) {
    const orderDetails = await this.ordersService.getOrderDetailsAsAdmin(id);
    return orderDetails;
  }

  @Get('admin/:id/invoice')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...PLATFORM_ROLES)
  async downloadAdminInvoice(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: FastifyReply,
  ) {
    await this.invoicesService.generateInvoicePdf(id, res);
  }

  @Patch('admin/:id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...PLATFORM_ROLES)
  async updateOrderStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('status') status: string,
  ) {
    const updated = await this.ordersService.updateOrderStatus(id, status);
    return {
      message: 'Order status updated',
      data: updated,
    };
  }
}
