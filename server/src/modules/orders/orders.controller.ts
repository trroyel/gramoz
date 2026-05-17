import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Res,
  UseGuards,
  HttpStatus,
  Patch,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
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

  @Post('checkout')
  async checkout(
    @CurrentUser() user: User,
    @Body() dto: CreateOrderDto,
    @Res() res: FastifyReply,
  ) {
    const order = await this.ordersService.createOrderFromCart(user.id, dto);
    return res.status(HttpStatus.CREATED).send({
      success: true,
      message: 'Order created successfully',
      data: order,
    });
  }

  @Get()
  async getUserOrders(@CurrentUser() user: User, @Res() res: FastifyReply) {
    const orders = await this.ordersService.getUserOrders(user.id);
    return res.send({
      success: true,
      data: orders,
    });
  }

  @Get(':id')
  async getOrderDetails(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Res() res: FastifyReply,
  ) {
    const orderDetails = await this.ordersService.getOrderDetails(user.id, id);
    return res.send({
      success: true,
      data: orderDetails,
    });
  }

  @Get('admin/all')
  @UseGuards(RolesGuard)
  @Roles(...PLATFORM_ROLES)
  async getAllOrdersAsAdmin(@Res() res: FastifyReply) {
    const orders = await this.ordersService.getAllOrdersAsAdmin();
    return res.send({
      success: true,
      data: orders,
    });
  }

  @Patch('admin/:id/status')
  @UseGuards(RolesGuard)
  @Roles(...PLATFORM_ROLES)
  async updateOrderStatus(
    @Param('id') id: string,
    @Body('status') status: string,
    @Res() res: FastifyReply,
  ) {
    const updated = await this.ordersService.updateOrderStatus(id, status);
    return res.send({
      success: true,
      message: 'Order status updated',
      data: updated,
    });
  }
}
