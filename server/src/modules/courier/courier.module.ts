import { Module } from '@nestjs/common';
import { CourierService } from './courier.service';
import { CourierController } from './courier.controller';
import { AdminCourierController } from './admin-courier.controller';

import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [CourierController, AdminCourierController],
  providers: [CourierService],
  exports: [CourierService],
})
export class CourierModule {}
