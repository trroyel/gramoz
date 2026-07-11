import { Module } from '@nestjs/common';
import { WishlistsController } from './wishlists.controller';
import { WishlistsService } from './wishlists.service';
import { WishlistsStore } from './wishlists.store';

@Module({
  controllers: [WishlistsController],
  providers: [WishlistsService, WishlistsStore],
})
export class WishlistsModule {}
