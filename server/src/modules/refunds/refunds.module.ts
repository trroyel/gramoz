import { Module } from '@nestjs/common';
import { RefundsController } from './refunds.controller';
import { RefundsService } from './refunds.service';
import { RefundsStore } from './refunds.store';
import { PaymentsModule } from '../payments/payments.module';
import { DatabaseModule } from '@database/database.module';

@Module({
  imports: [DatabaseModule, PaymentsModule],
  controllers: [RefundsController],
  providers: [RefundsService, RefundsStore],
  exports: [RefundsService, RefundsStore],
})
export class RefundsModule {}
