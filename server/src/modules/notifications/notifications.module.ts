import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@config/config.module';
import { MailService } from './mail.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [MailService],
  exports: [MailService],
})
export class NotificationsModule {}
