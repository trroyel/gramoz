import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { WishlistsService } from './wishlists.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('wishlists')
@UseGuards(JwtAuthGuard)
export class WishlistsController {
  constructor(private readonly wishlistsService: WishlistsService) {}

  @Post(':productId')
  async add(
    @Request() req: { user: { id: string } },
    @Param('productId') productId: string,
  ) {
    return this.wishlistsService.add(req.user.id, productId);
  }

  @Delete(':productId')
  async remove(
    @Request() req: { user: { id: string } },
    @Param('productId') productId: string,
  ) {
    return this.wishlistsService.remove(req.user.id, productId);
  }

  @Get()
  async getMyWishlist(@Request() req: { user: { id: string } }) {
    const data = await this.wishlistsService.findByUser(req.user.id);
    return { success: true, data };
  }

  @Get('check/:productId')
  async checkStatus(
    @Request() req: { user: { id: string } },
    @Param('productId') productId: string,
  ) {
    const data = await this.wishlistsService.check(req.user.id, productId);
    return { success: true, data };
  }
}
