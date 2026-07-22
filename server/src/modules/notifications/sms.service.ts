import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@config/config.service';

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Mock SMS sender.
   * In a real production environment, integrate with Twilio, SSLWireless, BulkSMSBD, etc.
   */
  async sendSms(phone: string, message: string): Promise<boolean> {
    try {
      this.logger.log(`\n================= SMS NOTIFICATION =================`);
      this.logger.log(`TO: ${phone}`);
      this.logger.log(`MESSAGE: ${message}`);
      this.logger.log(`====================================================\n`);
      
      // Simulate network delay
      await new Promise(resolve => setTimeout(resolve, 500));
      return true;
    } catch (error) {
      this.logger.error(`Failed to send SMS to ${phone}:`, error);
      return false;
    }
  }

  async sendOrderShippedSms(phone: string, orderId: string, trackingUrl?: string): Promise<boolean> {
    const id = orderId.slice(0, 8).toUpperCase();
    const text = trackingUrl
      ? `Gramoz: Your order #${id} has been shipped! Track it here: ${trackingUrl}`
      : `Gramoz: Your order #${id} has been shipped and is on its way!`;
    return this.sendSms(phone, text);
  }

  async sendOrderDeliveredSms(phone: string, orderId: string): Promise<boolean> {
    const id = orderId.slice(0, 8).toUpperCase();
    const text = `Gramoz: Your order #${id} has been delivered. Thank you for shopping with us!`;
    return this.sendSms(phone, text);
  }
}
