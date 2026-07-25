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
      const token = this.config.gwSmsToken;
      if (!token) {
        this.logger.warn(`GW_SMS_TOKEN is not set! Logging SMS locally: TO=${phone} MSG=${message}`);
        return true;
      }

      const body = new URLSearchParams({
        token,
        to: phone,
        message,
      });

      const response = await fetch('http://api.bdbulksms.net/api.php', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });

      const responseText = await response.text();
      this.logger.log(`BulkSMS BD API response for ${phone}: ${responseText}`);

      if (!response.ok) {
        throw new Error(`API returned HTTP status ${response.status}: ${responseText}`);
      }

      return true;
    } catch (error) {
      this.logger.error(`Failed to send SMS to ${phone}:`, error);
      return false;
    }
  }

  async sendVerificationSms(phone: string, code: string): Promise<boolean> {
    const text = `Your Gramoz verification code is ${code}. It expires in 10 minutes.`;
    return this.sendSms(phone, text);
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
