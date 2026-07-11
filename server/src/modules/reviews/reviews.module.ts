import { Module } from '@nestjs/common';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';
import { ReviewsStore } from './reviews.store';
import { DatabaseModule } from '@database/database.module';
import { OrdersModule } from '../orders/orders.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [DatabaseModule, OrdersModule, StorageModule],
  controllers: [ReviewsController],
  providers: [ReviewsService, ReviewsStore],
  exports: [ReviewsService, ReviewsStore],
})
export class ReviewsModule {}
