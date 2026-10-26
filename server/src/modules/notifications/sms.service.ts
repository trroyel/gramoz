import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@config/config.service';

/**
 * Normalizes and validates Bangladeshi phone numbers according to official BTRC standards.
 * Allowed operator prefixes: 013, 014, 015, 016, 017, 018, 019.
 * Accepts formats:
 *   - +8801XXXXXXXXX -> 8801XXXXXXXXX
 *   - 8801XXXXXXXXX  -> 8801XXXXXXXXX
 *   - 01XXXXXXXXX    -> 8801XXXXXXXXX
 * Rejects non-Bangladeshi or malformed numbers (e.g. invalid length, alphabetic characters).
 */
export function normalizeBangladeshiPhone(rawPhone: string): string | null {
  if (!rawPhone || typeof rawPhone !== 'string') return null;
  const cleaned = rawPhone.replace(/[\s\-()+]/g, '');

  if (/^8801[3-9]\d{8}$/.test(cleaned)) {
    return cleaned;
  }
  if (/^01[3-9]\d{8}$/.test(cleaned)) {
    return `88${cleaned}`;
  }
  return null;
}

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Dispatches an SMS notification via the configured provider (BulkSMSBD).
   * Validates recipient format, encrypts credentials over HTTPS, and enforces
   * a 10-second timeout to prevent worker lease stalls.
   */
  async sendSms(phone: string, message: string): Promise<boolean> {
    const normalized = normalizeBangladeshiPhone(phone);
    if (!normalized) {
      this.logger.warn(
        `Invalid or non-Bangladeshi recipient phone number: ${phone} — skipping SMS dispatch`,
      );
      return false;
    }

    try {
      const token = this.config.gwSmsToken;
      if (!token) {
        this.logger.warn(
          `GW_SMS_TOKEN is not configured! Logging SMS locally: TO=${normalized} MSG=${message}`,
        );
        return true;
      }

      const body = new URLSearchParams({
        token,
        to: normalized,
        message,
      });

      // SEC-24: Strictly enforce HTTPS and 10s AbortSignal timeout to protect secrets and avoid worker thread hangs
      const response = await fetch('https://api.bdbulksms.net/api.php', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
        signal: AbortSignal.timeout(10000),
      });

      const responseText = await response.text();
      this.logger.log(
        `BulkSMSBD API response for ${normalized}: ${responseText}`,
      );

      if (!response.ok) {
        throw new Error(
          `BulkSMSBD API returned HTTP ${response.status}: ${responseText}`,
        );
      }

      const trimmed = responseText.trim();
      // BulkSMSBD error codes:
      // 1000: Invalid user/token, 1002: Empty number, 1003: Invalid number,
      // 1004: Empty message, 1005: Invalid message, 1006: Insufficient balance
      // 1101: Success
      if (
        trimmed.startsWith('100') ||
        trimmed.toLowerCase().includes('error') ||
        trimmed.toLowerCase().includes('fail')
      ) {
        this.logger.error(
          `BulkSMSBD rejected SMS to ${normalized} with code/message: ${trimmed}`,
        );
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error(`Failed to send SMS to ${normalized}:`, error);
      return false;
    }
  }

  async sendVerificationSms(phone: string, code: string): Promise<boolean> {
    const text = `Your Gramoz verification code is ${code}. It expires in 10 minutes.`;
    return this.sendSms(phone, text);
  }

  async sendOrderShippedSms(
    phone: string,
    orderId: string,
    trackingUrl?: string,
  ): Promise<boolean> {
    const id = orderId.slice(0, 8).toUpperCase();
    const text = trackingUrl
      ? `Gramoz: Your order #${id} has been shipped! Track it here: ${trackingUrl}`
      : `Gramoz: Your order #${id} has been shipped and is on its way!`;
    return this.sendSms(phone, text);
  }

  async sendOrderDeliveredSms(
    phone: string,
    orderId: string,
  ): Promise<boolean> {
    const id = orderId.slice(0, 8).toUpperCase();
    const text = `Gramoz: Your order #${id} has been delivered. Thank you for shopping with us!`;
    return this.sendSms(phone, text);
  }
}
