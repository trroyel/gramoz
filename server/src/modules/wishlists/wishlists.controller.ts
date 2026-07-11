import { Controller, Get, Post, Delete, Param, UseGuards, Request } from '@nestjs/common';
import { WishlistsService } from './wishlists.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('wishlists')
@UseGuards(JwtAuthGuard)
export class WishlistsController {
  constructor(private readonly wishlistsService: WishlistsService) {}

  @Post(':productId')
  async add(@Request() req: any, @Param('productId') productId: string) {
    return this.wishlistsService.add(req.user.id, productId);
  }

  @Delete(':productId')
  async remove(@Request() req: any, @Param('productId') productId: string) {
    return this.wishlistsService.remove(req.user.id, productId);
  }

  @Get()
  async getMyWishlist(@Request() req: any) {
    return this.wishlistsService.findByUser(req.user.id);
  }

  @Get('check/:productId')
  async checkStatus(@Request() req: any, @Param('productId') productId: string) {
    return this.wishlistsService.check(req.user.id, productId);
  }
}
