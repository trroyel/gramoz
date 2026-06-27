import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, sql } from 'drizzle-orm';
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
    // ── Atomic claim with FOR UPDATE SKIP LOCKED ─────────────────────────────
    // This single statement atomically:
    //   1. Selects up to 10 pending events ordered by creation time
    //   2. Locks them with FOR UPDATE so no other connection can touch them
    //   3. SKIP LOCKED means a second instance running simultaneously will
    //      simply skip rows already locked by this instance — zero duplicates
    //   4. Increments attempts and sets status = 'processing' in the same step
    //   5. Returns the claimed rows via RETURNING *
    //
    // Result: even in a multi-instance / multi-pod deploy, each outbox event
    // is processed by exactly one worker. No distributed lock needed.
    const claimed = await this.db.execute<schema.OutboxEvent>(sql`
      UPDATE outbox_events
      SET
        status    = 'processing',
        attempts  = attempts + 1,
        updated_at = NOW()
      WHERE id IN (
        SELECT id
        FROM   outbox_events
        WHERE  status   = 'pending'
          AND  attempts < ${MAX_ATTEMPTS}
        ORDER  BY created_at ASC
        LIMIT  10
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *
    `);

    const events = claimed.rows as unknown as schema.OutboxEvent[];
    if (events.length === 0) return;

    this.logger.log(`Claimed ${events.length} outbox event(s) for processing`);

    for (const event of events) {
      await this.processEvent(event);
    }
  }

  private async processEvent(event: schema.OutboxEvent): Promise<void> {
    // NOTE: The event has already been claimed (status = 'processing',
    // attempts incremented) by the atomic UPDATE in processOutbox.
    // We only need to handle success / failure here.
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

      // attempts was already incremented in the claim query
      if (event.attempts >= MAX_ATTEMPTS) {
        // Exhausted retries — mark permanently failed for manual inspection
        await this.markFailed(event.id, errorMessage);
        this.logger.error(
          `Outbox event ${event.id} permanently failed after ${event.attempts} attempt(s).`,
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

