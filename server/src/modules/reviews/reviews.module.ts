import { Module } from '@nestjs/common';
import { ReviewsController } from './reviews.controller';
import { ReviewsAdminController } from './reviews-admin.controller';
import { ReviewsService } from './reviews.service';
import { ReviewsStore } from './reviews.store';
import { DatabaseModule } from '@database/database.module';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { SettingsModule } from '../settings/settings.module';
import { StorageModule } from '../storage/storage.module';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [DatabaseModule, LoyaltyModule, SettingsModule, StorageModule, OrdersModule],
  controllers: [ReviewsController, ReviewsAdminController],
  providers: [ReviewsService, ReviewsStore],
  exports: [ReviewsService, ReviewsStore],
})
export class ReviewsModule {}
