import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and } from 'drizzle-orm';
import { DATABASE } from '@database/database.module';
import * as schema from '@database/schema';
import { CourierService } from '../courier/courier.service';
import { MailService } from '../auth/mail.service';

const MAX_ATTEMPTS = 3;

/**
 * OutboxProcessor — Transactional Outbox Pattern worker.
 *
 * Polls the `outbox_events` table every 30 seconds for pending jobs and
 * processes them. This decouples external API calls (courier, etc.) from the
 * HTTP request lifecycle, guaranteeing that side effects are never lost even
 * if the process crashes between the DB commit and the external call.
 *
 * Supported event types:
 *   - CREATE_CONSIGNMENT: calls the Steadfast courier API and writes the
 *     resulting consignmentId + trackingUrl back to the order.
 */
@Injectable()
export class OutboxProcessor {
  private readonly logger = new Logger(OutboxProcessor.name);

  constructor(
    @Inject(DATABASE) private readonly db: NodePgDatabase<typeof schema>,
    private readonly courierService: CourierService,
    private readonly mailService: MailService,
  ) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async processOutbox(): Promise<void> {
    const pendingEvents = await this.db
      .select()
      .from(schema.outboxEvents)
      .where(
        and(
          eq(schema.outboxEvents.status, 'pending'),
        ),
      )
      .limit(10); // Process in batches of 10 to avoid overloading the event loop

    if (pendingEvents.length === 0) return;

    this.logger.log(`Processing ${pendingEvents.length} outbox event(s)...`);

    for (const event of pendingEvents) {
      await this.processEvent(event);
    }
  }

  private async processEvent(event: schema.OutboxEvent): Promise<void> {
    // Mark as processing to prevent concurrent workers from picking it up
    await this.db
      .update(schema.outboxEvents)
      .set({
        status: 'processing',
        attempts: event.attempts + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.outboxEvents.id, event.id),
          eq(schema.outboxEvents.status, 'pending'), // Optimistic lock
        ),
      );

    try {
      switch (event.type) {
        case 'CREATE_CONSIGNMENT':
          await this.handleCreateConsignment(event);
          break;
        case 'SEND_ORDER_CONFIRMATION':
          await this.handleSendOrderConfirmation(event);
          break;
        case 'SEND_LOW_STOCK_ALERT':
          await this.handleSendLowStockAlert(event);
          break;
        default:
          this.logger.warn(`Unknown outbox event type: ${event.type}`);
          await this.markFailed(event.id, `Unknown event type: ${event.type}`);
          return;
      }

      // Success — mark as completed
      await this.db
        .update(schema.outboxEvents)
        .set({ status: 'completed', updatedAt: new Date() })
        .where(eq(schema.outboxEvents.id, event.id));

      this.logger.log(
        `Outbox event ${event.id} (${event.type}) completed successfully.`,
      );
    } catch (error: any) {
      const errorMessage = error?.message ?? String(error);
      this.logger.error(
        `Outbox event ${event.id} (${event.type}) failed: ${errorMessage}`,
      );

      const nextAttempts = event.attempts + 1;
      if (nextAttempts >= MAX_ATTEMPTS) {
        // Exhausted retries — mark permanently failed for manual inspection
        await this.markFailed(event.id, errorMessage);
        this.logger.error(
          `Outbox event ${event.id} permanently failed after ${MAX_ATTEMPTS} attempts.`,
        );
      } else {
        // Reset to pending so the next cron tick retries it
        await this.db
          .update(schema.outboxEvents)
          .set({
            status: 'pending',
            lastError: errorMessage,
            updatedAt: new Date(),
          })
          .where(eq(schema.outboxEvents.id, event.id));
      }
    }
  }

  private async handleCreateConsignment(
    event: schema.OutboxEvent,
  ): Promise<void> {
    const payload = event.payload as { orderId: string };

    // Fetch all data needed for the courier API call
    const [order] = await this.db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, payload.orderId));

    if (!order) throw new Error(`Order ${payload.orderId} not found`);

    // Skip if a consignment was already created (idempotency guard)
    if (order.consignmentId) {
      this.logger.warn(
        `Order ${payload.orderId} already has consignmentId ${order.consignmentId} — skipping duplicate.`,
      );
      return;
    }

    const [user] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, order.userId));

    const [address] = await this.db
      .select()
      .from(schema.addresses)
      .where(eq(schema.addresses.id, order.shippingAddressId));

    const items = await this.db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, payload.orderId));

    const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);

    const consignment = await this.courierService.createConsignment({
      orderId: payload.orderId,
      recipientName: user?.fullName ?? 'Customer',
      recipientPhone: user?.phone ?? '0000000',
      recipientAddress: address?.addressLine1 ?? 'Unknown',
      recipientCity: address?.city ?? 'Unknown',
      amountToCollect: parseFloat(order.totalAmount),
      itemQuantity: totalQuantity,
      itemWeight: 0.5,
    });

    if (!consignment.success || !consignment.consignmentId) {
      throw new Error(
        consignment.message ?? 'Courier API returned a failure response',
      );
    }

    // Write tracking info back to the order
    await this.db
      .update(schema.orders)
      .set({
        consignmentId: consignment.consignmentId,
        trackingUrl: consignment.trackingUrl ?? '',
        updatedAt: new Date(),
      })
      .where(eq(schema.orders.id, payload.orderId));
  }

  private async markFailed(eventId: string, error: string): Promise<void> {
    await this.db
      .update(schema.outboxEvents)
      .set({
        status: 'failed',
        lastError: error,
        updatedAt: new Date(),
      })
      .where(eq(schema.outboxEvents.id, eventId));
  }

  private async handleSendOrderConfirmation(
    event: schema.OutboxEvent,
  ): Promise<void> {
    // Payload is self-contained — no extra DB queries needed.
    const payload = event.payload as {
      email: string;
      fullName: string;
      orderId: string;
      items: Array<{ productName: string; quantity: number; unitPrice: string }>;
      totalAmount: string;
    };

    await this.mailService.sendOrderConfirmation(
      payload.email,
      payload.fullName,
      payload.orderId,
      payload.items,
      payload.totalAmount,
    );
  }

  private async handleSendLowStockAlert(
    event: schema.OutboxEvent,
  ): Promise<void> {
    const payload = event.payload as { productIds: string[] };
    const THRESHOLD = parseInt(process.env.LOW_STOCK_THRESHOLD ?? '5', 10);

    // Fetch fresh stock values at processing time — more accurate than
    // snapshotting values at order-creation time.
    const rows = await Promise.all(
      payload.productIds.map((id) =>
        this.db
          .select({ name: schema.products.name, stock: schema.products.stock })
          .from(schema.products)
          .where(eq(schema.products.id, id))
          .then((r) => r[0]),
      ),
    );

    const lowStock = rows
      .filter((p) => p && p.stock <= THRESHOLD)
      .map((p) => ({ name: p!.name, stock: p!.stock, threshold: THRESHOLD }));

    if (lowStock.length > 0) {
      await this.mailService.sendLowStockAlert(lowStock);
    }
  }
}

