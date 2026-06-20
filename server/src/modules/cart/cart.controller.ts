import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';

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
  async getCart(@CurrentUser() user: User) {
    const cart = await this.cartService.getCart(user.id);
    return cart;
  }

  @Post('items')
  async addItem(@CurrentUser() user: User, @Body() dto: AddToCartDto) {
    const item = await this.cartService.addItem(user.id, dto);
    return { message: 'Item added to cart', data: item };
  }

  @Put('items/:itemId')
  async updateItem(
    @CurrentUser() user: User,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateCartItemDto,
  ) {
    const item = await this.cartService.updateItem(
      user.id,
      itemId,
      dto.quantity,
    );
    return { message: 'Cart updated', data: item };
  }

  @Delete('items/:itemId')
  async removeItem(@CurrentUser() user: User, @Param('itemId') itemId: string) {
    await this.cartService.removeItem(user.id, itemId);
    return { message: 'Item removed from cart' };
  }

  @Delete()
  async clearCart(@CurrentUser() user: User) {
    await this.cartService.clearCart(user.id);
    return { message: 'Cart cleared' };
  }
}
