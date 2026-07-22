import { Module, Global } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { StorefrontController } from './storefront.controller';
import { SettingsService } from './settings.service';
import { SettingsStore } from './settings.store';
import { DatabaseModule } from '@database/database.module';
import { StorageModule } from '../storage/storage.module';

@Global()
@Module({
  imports: [DatabaseModule, StorageModule],
  controllers: [SettingsController, StorefrontController],
  providers: [SettingsService, SettingsStore],
  exports: [SettingsService, SettingsStore],
})
export class SettingsModule {}
