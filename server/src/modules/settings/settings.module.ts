import { Module, Global } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { SettingsStore } from './settings.store';
import { DatabaseModule } from '@database/database.module';

@Global()
@Module({
  imports: [DatabaseModule],
  controllers: [SettingsController],
  providers: [SettingsService, SettingsStore],
  exports: [SettingsService, SettingsStore],
})
export class SettingsModule {}
