import { Module } from '@nestjs/common';
import { PromosService } from './promos.service';
import { PromosController } from './controllers/promos/promos.controller';
import { PromosAdminController } from './controllers/promos-admin/promos-admin.controller';

@Module({
  providers: [PromosService],
  controllers: [PromosController, PromosAdminController],
  exports: [PromosService],
})
export class PromosModule {}
