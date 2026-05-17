import { Injectable } from '@nestjs/common';
import { Resend } from 'resend';
import { ConfigService } from '@config/config.service';
import {
  verificationEmailTemplate,
  passwordResetTemplate,
  welcomeEmailTemplate,
} from './templates';

@Injectable()
export class MailService {
  private readonly resend: Resend;

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
}
