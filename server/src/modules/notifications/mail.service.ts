import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { ConfigService } from '@config/config.service';
import {
  verificationEmailTemplate,
  passwordResetTemplate,
  welcomeEmailTemplate,
  orderConfirmationTemplate,
  lowStockAlertTemplate,
} from './templates';

@Injectable()
export class MailService {
  private readonly resend: Resend;
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly config: ConfigService) {
    this.resend = new Resend(this.config.emailApiKey);
  }

  async sendVerificationEmail(
    email: string,
    code: string,
    fullName: string,
  ): Promise<void> {
    await this.resend.emails.send({
      from: this.config.emailFrom,
      to: email,
      subject: 'Verify Your Email - Gramoz',
      html: verificationEmailTemplate(fullName, code),
    });
  }

  async sendPasswordResetEmail(
    email: string,
    code: string,
    fullName: string,
  ): Promise<void> {
    await this.resend.emails.send({
      from: this.config.emailFrom,
      to: email,
      subject: 'Reset Your Password - Gramoz',
      html: passwordResetTemplate(fullName, code),
    });
  }

  async sendWelcomeEmail(email: string, fullName: string): Promise<void> {
    await this.resend.emails.send({
      from: this.config.emailFrom,
      to: email,
      subject: 'Welcome to Gramoz!',
      html: welcomeEmailTemplate(fullName),
    });
  }

  async sendOrderConfirmation(
    email: string,
    fullName: string,
    orderId: string,
    items: Array<{
      productName: string | null;
      quantity: number;
      unitPrice: string;
    }>,
    totalAmount: string,
  ): Promise<void> {
    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
    try {
      await this.resend.emails.send({
        from: this.config.emailFrom,
        to: email,
        subject: `Order Confirmed #${orderId.slice(0, 8).toUpperCase()} - Gramoz`,
        html: orderConfirmationTemplate(
          fullName,
          orderId,
          items,
          totalAmount,
          frontendUrl,
        ),
      });
    } catch (error) {
      // Log but never throw — a failed email must not crash the order creation
      this.logger.error(
        `Failed to send order confirmation to ${email}:`,
        error,
      );
    }
  }

  async sendLowStockAlert(
    products: Array<{ name: string; stock: number; threshold: number }>,
  ): Promise<void> {
    const adminEmail = this.config.adminEmail;
    if (!adminEmail) {
      this.logger.warn('ADMIN_EMAIL not set — skipping low-stock alert email');
      return;
    }
    const frontendUrl = this.config.frontendUrl;
    try {
      await this.resend.emails.send({
        from: this.config.emailFrom,
        to: adminEmail,
        subject: `⚠️ Low Stock: ${products.length} product${products.length > 1 ? 's need' : ' needs'} restocking — Gramoz`,
        html: lowStockAlertTemplate(products, frontendUrl),
      });
    } catch (error) {
      this.logger.error('Failed to send low-stock alert:', error);
    }
  }
}
