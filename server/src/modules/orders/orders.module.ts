import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrdersStore } from './orders.store';
import { OutboxProcessor } from './outbox.processor';
import { CourierModule } from '../courier/courier.module';
import { AuthModule } from '../auth/auth.module';
import { PromosModule } from '../promos/promos.module';
import { DatabaseModule } from '@database/database.module';

@Module({
  imports: [DatabaseModule, CourierModule, AuthModule, PromosModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrdersStore, OutboxProcessor],
  exports: [OrdersService, OrdersStore],
})
export class OrdersModule {}
