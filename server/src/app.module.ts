import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';

import { ConfigModule } from '@config/config.module';
import { DatabaseModule } from '@database/database.module';
import { RedisModule } from '@cache/redis.module';
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

@Module({
  imports: [
    // Global rate limiter — 60 requests per 60 seconds per IP by default.
    // Auth routes override this with tighter limits via @Throttle() decorators.
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000,
        limit: 60,
      },
    ]),
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
  ],
  controllers: [],
  providers: [
    // Apply throttler globally to every route
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
