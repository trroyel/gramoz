import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { DATABASE } from '@database/database.module';
import * as schema from '@database/schema';
import { MailService } from '../notifications/mail.service';
import { SettingsService } from '../settings/settings.service';

export interface AbandonedCartScanResult {
  scannedUsers: number;
  enqueuedEvents: number;
}

const DEFAULT_BATCH_SIZE = 50;

@Injectable()
export class AbandonedCartProcessor {
  private readonly logger = new Logger(AbandonedCartProcessor.name);

  constructor(
    @Inject(DATABASE) private readonly db: NodePgDatabase<typeof schema>,
    private readonly mailService: MailService,
    private readonly settingsService: SettingsService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async processAbandonedCarts(
    batchSize: number = DEFAULT_BATCH_SIZE,
  ): Promise<AbandonedCartScanResult> {
    this.logger.log('Scanning for abandoned carts...');

    try {
      const idleHours = await this.settingsService.getAbandonedCartIdleHours();

      // Phase 5 & 6 Invariant:
      // A cart is considered abandoned IF AND ONLY IF:
      // 1. The user has at least 1 cart item.
      // 2. The entire cart is idle: MAX(c.updated_at) < NOW() - INTERVAL '1 hour' * idleHours.
      //    (If the user interacted with any cart item recently, the entire cart is active).
      // 3. None of the active cart items have already been notified: bool_or(c.abandoned_email_sent) = false.
      // 4. The user is active, email-verified, and not deleted.
      // 5. At least one product is active and not deleted.
      const candidateUsers = await this.db.execute<{
        userId: string;
        userEmail: string;
        userFullName: string;
      }>(sql`
        SELECT 
          c.user_id as "userId",
          u.email as "userEmail",
          u.full_name as "userFullName"
        FROM cart_items c
        JOIN users u ON c.user_id = u.id
        JOIN products p ON c.product_id = p.id
        WHERE u.status = 'active'
          AND u.deleted_at IS NULL
          AND u.is_email_verified = true
          AND p.status = 'active'
          AND p.deleted_at IS NULL
        GROUP BY c.user_id, u.email, u.full_name
        HAVING MAX(c.updated_at) < NOW() - INTERVAL '1 hour' * ${idleHours}
           AND bool_or(c.abandoned_email_sent) = false
        ORDER BY MIN(c.created_at) ASC
        LIMIT ${batchSize}
      `);

      if (candidateUsers.rows.length === 0) {
        return { scannedUsers: 0, enqueuedEvents: 0 };
      }

      this.logger.log(
        `Discovered ${candidateUsers.rows.length} candidate abandoned carts for processing.`,
      );

      let enqueuedCount = 0;

      // Process each candidate user in an atomic transaction to guarantee concurrency safety (CONC-19-K)
      for (const candidate of candidateUsers.rows) {
        const enqueued = await this.db.transaction(async (tx) => {
          // Atomic Claim: Update abandoned_email_sent = true only if not already claimed
          const claimedItems = await tx.execute<{
            id: string;
            productId: string;
            variantId: string | null;
            quantity: number;
          }>(sql`
            UPDATE cart_items
            SET abandoned_email_sent = true,
                updated_at = NOW()
            WHERE user_id = ${candidate.userId}
              AND abandoned_email_sent = false
            RETURNING id, product_id as "productId", variant_id as "variantId", quantity
          `);

          if (claimedItems.rows.length === 0) {
            // Another concurrent worker or checkout operation already handled/cleared this cart
            return false;
          }

          // Fetch fresh product and variant pricing and stock for the claimed items
          const itemDetails = await tx.execute<{
            cartItemId: string;
            quantity: number;
            productName: string;
            unitPrice: string;
            variantAttributes: any;
            productStock: number;
            variantStock: number | null;
          }>(sql`
            SELECT 
              c.id as "cartItemId",
              c.quantity,
              p.name as "productName",
              COALESCE(pv.price, p.price) as "unitPrice",
              pv.attributes as "variantAttributes",
              p.stock as "productStock",
              pv.stock as "variantStock"
            FROM cart_items c
            JOIN products p ON c.product_id = p.id
            LEFT JOIN product_variants pv ON c.variant_id = pv.id
            WHERE c.id IN (${sql.join(
              claimedItems.rows.map((r) => sql`${r.id}::uuid`),
              sql`, `,
            )})
              AND p.status = 'active'
              AND p.deleted_at IS NULL
          `);

          // Filter for available stock
          const availableItems = itemDetails.rows.filter((item) => {
            const stock =
              item.variantStock !== null
                ? item.variantStock
                : item.productStock;
            return stock > 0;
          });

          if (availableItems.length === 0) {
            this.logger.log(
              `Skipping abandoned cart email for user ${candidate.userId}: all items out of stock or inactive.`,
            );
            return false;
          }

          const formattedItems = availableItems.map((item) => {
            let name = item.productName;
            if (
              item.variantAttributes &&
              typeof item.variantAttributes === 'object'
            ) {
              const attrs = Object.entries(item.variantAttributes)
                .map(([k, v]) => `${k}: ${v}`)
                .join(', ');
              if (attrs) {
                name = `${name} (${attrs})`;
              }
            }
            return {
              productName: name,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
            };
          });

          // Insert outbox event within the SAME atomic transaction
          await tx.insert(schema.outboxEvents).values({
            type: 'SEND_ABANDONED_CART_EMAIL',
            payload: {
              userId: candidate.userId,
              email: candidate.userEmail,
              fullName: candidate.userFullName,
              items: formattedItems,
            },
          });

          return true;
        });

        if (enqueued) {
          enqueuedCount++;
        }
      }

      this.logger.log(
        `Successfully claimed and enqueued ${enqueuedCount} abandoned cart reminder(s).`,
      );

      return {
        scannedUsers: candidateUsers.rows.length,
        enqueuedEvents: enqueuedCount,
      };
    } catch (error) {
      this.logger.error('Error processing abandoned carts:', error);
      return { scannedUsers: 0, enqueuedEvents: 0 };
    }
  }
}
