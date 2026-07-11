import { Module } from '@nestjs/common';
import { AddressesService } from './addresses.service';
import { AddressesStore } from './addresses.store';
import { AddressesController } from './addresses.controller';
import { DatabaseModule } from '@database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [AddressesController],
  providers: [AddressesService, AddressesStore],
  exports: [AddressesService, AddressesStore],
})
export class AddressesModule {}
