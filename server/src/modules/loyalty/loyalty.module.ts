import { Module, Global } from '@nestjs/common';
import { LoyaltyController } from './loyalty.controller';
import { LoyaltyService } from './loyalty.service';
import { LoyaltyStore } from './loyalty.store';
import { DatabaseModule } from '@database/database.module';

@Global()
@Module({
  imports: [DatabaseModule],
  controllers: [LoyaltyController],
  providers: [LoyaltyService, LoyaltyStore],
  exports: [LoyaltyService, LoyaltyStore],
})
export class LoyaltyModule {}
