import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and, sql } from 'drizzle-orm';
import { DATABASE } from '@database/database.module';
import * as schema from '@database/schema';
import { MailService } from '../notifications/mail.service';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class AbandonedCartProcessor {
  private readonly logger = new Logger(AbandonedCartProcessor.name);

  constructor(
    @Inject(DATABASE) private readonly db: NodePgDatabase<typeof schema>,
    private readonly mailService: MailService,
    private readonly settingsService: SettingsService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async processAbandonedCarts(): Promise<void> {
    this.logger.log('Scanning for abandoned carts...');

    try {
      const idleHours = await this.settingsService.getAbandonedCartIdleHours();
      
      // Select users who have at least one cart item that is older than `idleHours`
      // and hasn't had an email sent for it yet.
      // We will select the actual cart items as well to build the email.
      const abandonedItems = await this.db.execute<{
        userId: string;
        cartItemId: string;
        quantity: number;
        productName: string;
        productPrice: string;
        userEmail: string;
        userFullName: string;
      }>(sql`
        SELECT 
          c.user_id as "userId",
          c.id as "cartItemId",
          c.quantity as "quantity",
          p.name as "productName",
          p.price as "productPrice",
          u.email as "userEmail",
          u.full_name as "userFullName"
        FROM cart_items c
        JOIN users u ON c.user_id = u.id
        JOIN products p ON c.product_id = p.id
        WHERE c.updated_at < NOW() - INTERVAL '1 hour' * ${idleHours}
          AND c.abandoned_email_sent = false
      `);

      if (abandonedItems.rows.length === 0) {
        return;
      }

      // Group items by user
      const usersCarts = new Map<string, {
        email: string;
        fullName: string;
        items: Array<{ productName: string; quantity: number; unitPrice: string }>;
        cartItemIds: string[];
      }>();

      for (const row of abandonedItems.rows) {
        if (!usersCarts.has(row.userId)) {
          usersCarts.set(row.userId, {
            email: row.userEmail,
            fullName: row.userFullName,
            items: [],
            cartItemIds: [],
          });
        }
        
        const userCart = usersCarts.get(row.userId)!;
        userCart.items.push({
          productName: row.productName,
          quantity: row.quantity,
          unitPrice: row.productPrice,
        });
        userCart.cartItemIds.push(row.cartItemId);
      }

      this.logger.log(`Found ${usersCarts.size} abandoned carts to process.`);

      // Send emails and mark as sent
      for (const [userId, cart] of usersCarts.entries()) {
        await this.mailService.sendAbandonedCartEmail(cart.email, cart.fullName, cart.items);

        // Mark these specific cart items as sent
        await this.db.execute(sql`
          UPDATE cart_items
          SET abandoned_email_sent = true
          WHERE id = ANY(${cart.cartItemIds}::uuid[])
        `);
      }

      this.logger.log(`Successfully processed ${usersCarts.size} abandoned carts.`);

    } catch (error) {
      this.logger.error('Error processing abandoned carts:', error);
    }
  }
}
