import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Patch,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { OrdersService } from './orders.service';
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
  constructor(private readonly ordersService: OrdersService) {}

  // Tight limit — checkout hits DB, stock, inventory, and external email on every call.
  // 5 per minute per IP is enough for any real user; stops abuse and double-submit spam.
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('checkout')
  async checkout(@CurrentUser() user: User, @Body() dto: CreateOrderDto) {
    const order = await this.ordersService.createOrderFromCart(user.id, dto);
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
  async getOrderDetails(@CurrentUser() user: User, @Param('id') id: string) {
    const orderDetails = await this.ordersService.getOrderDetails(user.id, id);
    return orderDetails;
  }

  @Get('admin/all')
  @UseGuards(RolesGuard)
  @Roles(...PLATFORM_ROLES)
  async getAllOrdersAsAdmin() {
    const orders = await this.ordersService.getAllOrdersAsAdmin();
    return orders;
  }

  @Get('admin/:id')
  @UseGuards(RolesGuard)
  @Roles(...PLATFORM_ROLES)
  async getOrderDetailsAsAdmin(@Param('id') id: string) {
    const orderDetails = await this.ordersService.getOrderDetailsAsAdmin(id);
    return orderDetails;
  }

  @Patch('admin/:id/status')
  @UseGuards(RolesGuard)
  @Roles(...PLATFORM_ROLES)
  async updateOrderStatus(
    @Param('id') id: string,
    @Body('status') status: string,
  ) {
    const updated = await this.ordersService.updateOrderStatus(id, status);
    return {
      message: 'Order status updated',
      data: updated,
    };
  }
}
