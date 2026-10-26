import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';

import { ConfigModule } from '@config/config.module';
import { DatabaseModule } from '@database/database.module';
import { RedisModule } from '@cache/redis.module';
import { RedisService } from '@cache/redis.service';
import { ThrottlerStorageRedisService } from '@cache/throttler-storage-redis.service';
import {
  AppThrottlerGuard,
  normalizeAccountIdentifier,
} from './common/guards/app-throttler.guard';
import { AuthModule } from '@modules/auth/auth.module';
import { UserModule } from '@modules/users/user.module';
import { ProductsModule } from '@modules/products/products.module';
import { CategoriesModule } from '@modules/categories/categories.module';
import { CartModule } from '@modules/cart/cart.module';
import { OrdersModule } from '@modules/orders/orders.module';
import { PaymentsModule } from '@modules/payments/payments.module';
import { HealthModule } from '@modules/health/health.module';
import { StorageModule } from '@modules/storage/storage.module';
import { RefundsModule } from '@modules/refunds/refunds.module';
import { PromosModule } from './modules/promos/promos.module';
import { AddressesModule } from './modules/addresses/addresses.module';
import { SettingsModule } from './modules/settings/settings.module';
import { LoyaltyModule } from './modules/loyalty/loyalty.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { WishlistsModule } from './modules/wishlists/wishlists.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';

@Module({
  imports: [
    // Global and endpoint-specific rate limiter:
    // - 'default': IP-based counter (60 req/min global default)
    // - 'account': Normalized account identifier counter (prevents targeted brute-force)
    // Distributed state is synchronized across instances via Redis with in-memory fail-policy fallback.
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule, RedisModule],
      inject: [RedisService],
      useFactory: (redis: RedisService) => ({
        throttlers: [
          {
            name: 'default',
            ttl: 60_000,
            limit: 60,
          },
          {
            name: 'account',
            ttl: 60_000,
            limit: 5,
            getTracker: (req) => {
              return normalizeAccountIdentifier(req?.body) || 'anonymous';
            },
          },
        ],
        storage: new ThrottlerStorageRedisService(redis.getClient()),
      }),
    }),
    ScheduleModule.forRoot(),
    ConfigModule,
    DatabaseModule,
    RedisModule,
    AuthModule,
    UserModule,
    ProductsModule,
    CategoriesModule,
    CartModule,
    OrdersModule,
    PaymentsModule,
    HealthModule,
    StorageModule,
    RefundsModule,
    PromosModule,
    AddressesModule,
    SettingsModule,
    LoyaltyModule,
    ReviewsModule,
    WishlistsModule,
    NotificationsModule,
    AnalyticsModule,
  ],
  controllers: [],
  providers: [
    // Apply production throttler guard globally to every route
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
  ],
})
export class AppModule {}
