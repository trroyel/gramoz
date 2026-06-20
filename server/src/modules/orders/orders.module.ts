import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OutboxProcessor } from './outbox.processor';
import { CourierModule } from '../courier/courier.module';
import { AuthModule } from '../auth/auth.module';
import { PromosModule } from '../promos/promos.module';

@Module({
  imports: [CourierModule, AuthModule, PromosModule],
  controllers: [OrdersController],
  providers: [OrdersService, OutboxProcessor],
  exports: [OrdersService],
})
export class OrdersModule {}
