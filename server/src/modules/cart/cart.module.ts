import { Module } from '@nestjs/common';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';
import { CartStore } from './cart.store';
import { DatabaseModule } from '@database/database.module';
import { AbandonedCartProcessor } from './abandoned-cart.processor';

@Module({
  imports: [DatabaseModule],
  controllers: [CartController],
  providers: [CartService, CartStore, AbandonedCartProcessor],
  exports: [CartService, CartStore],
})
export class CartModule {}
