import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrdersStore } from './orders.store';
import { OutboxProcessor } from './outbox.processor';
import { CourierModule } from '../courier/courier.module';
import { AuthModule } from '../auth/auth.module';
import { PromosModule } from '../promos/promos.module';
import { DatabaseModule } from '@database/database.module';
import { InvoicesService } from './invoices.service';

import { OrdersExpiryProcessor } from './orders-expiry.processor';

@Module({
  imports: [DatabaseModule, CourierModule, AuthModule, PromosModule],
  controllers: [OrdersController],
  providers: [
    OrdersService,
    OrdersStore,
    OutboxProcessor,
    OrdersExpiryProcessor,
    InvoicesService,
  ],
  exports: [OrdersService, OrdersStore, OrdersExpiryProcessor],
})
export class OrdersModule {}
