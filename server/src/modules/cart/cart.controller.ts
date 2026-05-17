import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Res,
  UseGuards,
  HttpStatus,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { CartService } from './cart.service';
import { AddToCartDto } from './dto/add-to-cart.dto';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import type { User } from '@database/schema';
import { IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

class UpdateCartItemDto {
  @IsInt()
  @Min(1)
  @Type(() => Number)
  quantity: number;
}

@UseGuards(JwtAuthGuard)
@Controller('cart')
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get()
  async getCart(@CurrentUser() user: User, @Res() res: FastifyReply) {
    const cart = await this.cartService.getCart(user.id);
    return res.send({ success: true, data: cart });
  }

  @Post('items')
  async addItem(
    @CurrentUser() user: User,
    @Body() dto: AddToCartDto,
    @Res() res: FastifyReply,
  ) {
    const item = await this.cartService.addItem(user.id, dto);
    return res
      .status(HttpStatus.CREATED)
      .send({ success: true, message: 'Item added to cart', data: item });
  }

  @Put('items/:itemId')
  async updateItem(
    @CurrentUser() user: User,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateCartItemDto,
    @Res() res: FastifyReply,
  ) {
    const item = await this.cartService.updateItem(user.id, itemId, dto.quantity);
    return res.send({ success: true, message: 'Cart updated', data: item });
  }

  @Delete('items/:itemId')
  async removeItem(
    @CurrentUser() user: User,
    @Param('itemId') itemId: string,
    @Res() res: FastifyReply,
  ) {
    await this.cartService.removeItem(user.id, itemId);
    return res.send({ success: true, message: 'Item removed from cart' });
  }

  @Delete()
  async clearCart(@CurrentUser() user: User, @Res() res: FastifyReply) {
    await this.cartService.clearCart(user.id);
    return res.send({ success: true, message: 'Cart cleared' });
  }
}
