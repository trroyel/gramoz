import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@config/config.module';
import { MailService } from './mail.service';
import { SmsService } from './sms.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [MailService, SmsService],
  exports: [MailService, SmsService],
})
export class NotificationsModule {}
