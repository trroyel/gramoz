import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, sql, desc, and, isNull, lte } from 'drizzle-orm';
import { DATABASE } from '@database/database.module';
import * as schema from '@database/schema';
import { CourierService } from '../courier/courier.service';
import { MailService } from '../notifications/mail.service';
import { SmsService } from '../notifications/sms.service';

const MAX_ATTEMPTS = 3;

/**
 * Thrown for conditions that must NOT be retried automatically (e.g. a courier
 * shipment that may already exist at the provider but cannot be linked to the
 * order). The event is dead-lettered immediately for manual reconciliation.
 */
export class NonRetryableOutboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableOutboxError';
  }
}

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
    private readonly smsService: SmsService,
  ) {}

  /**
   * Recovers events stranded in 'processing' status due to worker crash,
   * unhandled exception, SIGTERM/SIGKILL during deployment, or network timeout.
   *
   * An event is considered stranded if its status is 'processing' and its
   * `updated_at` has not been refreshed for over 5 minutes.
   * - If attempts < MAX_ATTEMPTS: resets to 'pending' for safe retry.
   * - If attempts >= MAX_ATTEMPTS: marks permanently 'failed' with error explanation.
   */
  async recoverStrandedEvents(): Promise<number> {
    const res = await this.db.execute<{ id: string }>(sql`
      UPDATE outbox_events
      SET
        status = CASE
          WHEN attempts < ${MAX_ATTEMPTS} THEN 'pending'::outbox_status
          ELSE 'failed'::outbox_status
        END,
        last_error = COALESCE(last_error, 'Worker lease expired / worker process interrupted'),
        updated_at = NOW()
      WHERE status = 'processing'
        AND updated_at < NOW() - INTERVAL '5 minutes'
      RETURNING id
    `);

    const recoveredCount = res.rows.length;
    if (recoveredCount > 0) {
      this.logger.warn(
        `Recovered ${recoveredCount} stranded outbox event(s) from crashed / timed-out workers.`,
      );
    }
    return recoveredCount;
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async processOutbox(): Promise<{
    claimed: number;
    completed: number;
    failed: number;
    recovered: number;
  }> {
    let recovered = 0;
    let completed = 0;
    let failed = 0;

    try {
      // 1. Recover any stranded processing events from crashed workers before polling
      recovered = await this.recoverStrandedEvents();

      // 2. Atomic claim with FOR UPDATE SKIP LOCKED
      // Uses partial index 'outbox_events_pending_idx' (created_at ASC WHERE status = 'pending' AND attempts < 3)
      // for sub-0.1ms lock-free event acquisition.
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
      if (events.length === 0) {
        return { claimed: 0, completed: 0, failed: 0, recovered };
      }

      this.logger.log(
        `Claimed ${events.length} outbox event(s) for processing`,
      );

      for (const event of events) {
        const success = await this.processEvent(event);
        if (success) {
          completed++;
        } else {
          failed++;
        }
      }

      return { claimed: events.length, completed, failed, recovered };
    } catch (err: unknown) {
      const errMsg =
        err instanceof Error
          ? err.message
          : typeof err === 'string'
            ? err
            : JSON.stringify(err);
      const errStack = err instanceof Error ? err.stack : undefined;
      this.logger.error(
        `Error executing outbox processor: ${errMsg}`,
        errStack,
      );
      return { claimed: 0, completed, failed, recovered };
    }
  }

  async processEvent(event: schema.OutboxEvent): Promise<boolean> {
    // NOTE: The event has already been claimed (status = 'processing',
    // attempts incremented) by the atomic UPDATE in processOutbox.
    // We only need to handle success / failure here.
    try {
      // Lease-ownership fencing (TASK-26): before ANY external side effect, prove that
      // this worker still owns the claim (status='processing' AND attempts equals the
      // value returned by the claim) and renew the lease atomically. A worker whose
      // lease expired and whose event was recovered/re-claimed matches 0 rows and exits
      // without performing duplicate SMS / email / courier / refund side effects.
      const owned = await this.db
        .update(schema.outboxEvents)
        .set({ updatedAt: new Date() })
        .where(
          and(
            eq(schema.outboxEvents.id, event.id),
            eq(schema.outboxEvents.status, 'processing'),
            eq(schema.outboxEvents.attempts, event.attempts),
          ),
        )
        .returning({ id: schema.outboxEvents.id });

      if (owned.length === 0) {
        this.logger.warn(
          `Outbox event ${event.id} (${event.type}) lease lost before execution — skipping (another worker owns it or it is already terminal).`,
        );
        return false;
      }

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
        case 'SEND_SMS':
          await this.handleSendSms(event);
          break;
        case 'REFUND_REQUIRED':
          await this.handleRefundRequired(event);
          break;
        case 'RECONCILIATION_REQUIRED':
          await this.handleReconciliationRequired(event);
          break;
        case 'SEND_ABANDONED_CART_EMAIL':
          await this.handleSendAbandonedCartEmail(event);
          break;
        default:
          this.logger.warn(`Unknown outbox event type: ${event.type}`);
          await this.markFailed(event.id, `Unknown event type: ${event.type}`);
          return false;
      }

      // Success — mark as completed with optimistic fencing
      // Uses monotonic attempt counter: if a worker lease expired and was claimed with attempts > event.attempts,
      // the stale worker's update matches 0 rows and cannot overwrite newer worker state.
      await this.db
        .update(schema.outboxEvents)
        .set({ status: 'completed', updatedAt: new Date() })
        .where(
          and(
            eq(schema.outboxEvents.id, event.id),
            eq(schema.outboxEvents.attempts, event.attempts),
          ),
        );

      this.logger.log(
        `Outbox event ${event.id} (${event.type}) completed successfully.`,
      );
      return true;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : JSON.stringify(error);
      this.logger.error(
        `Outbox event ${event.id} (${event.type}) failed: ${errorMessage}`,
      );

      // attempts was already incremented in the claim query
      if (error instanceof NonRetryableOutboxError) {
        await this.markFailed(event.id, errorMessage, event.attempts);
        this.logger.error(
          `Outbox event ${event.id} dead-lettered for manual reconciliation (non-retryable).`,
        );
      } else if (event.attempts >= MAX_ATTEMPTS) {
        // Exhausted retries — mark permanently failed for manual inspection (with fencing)
        await this.markFailed(event.id, errorMessage, event.attempts);
        this.logger.error(
          `Outbox event ${event.id} permanently failed after ${event.attempts} attempt(s).`,
        );
      } else {
        // Reset to pending so the next cron tick retries it (with fencing)
        await this.db
          .update(schema.outboxEvents)
          .set({
            status: 'pending',
            lastError: errorMessage,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.outboxEvents.id, event.id),
              eq(schema.outboxEvents.attempts, event.attempts),
              eq(schema.outboxEvents.status, 'processing'),
            ),
          );
      }
      return false;
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

    // Prevent dispatch if order was cancelled or refunded
    if (order.status === 'cancelled' || order.status === 'refunded') {
      this.logger.warn(
        `Order ${payload.orderId} is in status '${order.status}' — skipping consignment creation.`,
      );
      return;
    }

    // Skip if a real consignment was already created (idempotency guard)
    if (order.consignmentId && order.consignmentId !== 'PENDING_DISPATCH') {
      this.logger.warn(
        `Order ${payload.orderId} already has consignmentId ${order.consignmentId} — skipping duplicate.`,
      );
      return;
    }

    let consignment: {
      success: boolean;
      ambiguous?: boolean;
      consignmentId?: string;
      trackingCode?: string;
      trackingUrl?: string;
      message?: string;
    } | null = null;

    // A previous attempt may have reached the provider if the dispatch sentinel is still
    // set on a retry (ambiguous create outcome or worker crash after claiming).
    const priorDispatchUncertain =
      event.attempts > 1 && order.consignmentId === 'PENDING_DISPATCH';

    // Phase 4 / CONC-24-C: If this is a retried event (attempts > 1), inquire provider first
    // to check if consignment was created before a previous worker crash
    if (event.attempts > 1) {
      const existing = await this.courierService.getConsignmentByInvoice(
        payload.orderId,
      );
      if (existing) {
        if (existing.ambiguous) {
          throw new Error(
            `Courier inquiry for order ${payload.orderId} returned ambiguous result (${existing.message}) — deferring consignment creation to prevent duplicate shipment.`,
          );
        }
        if (existing.success && existing.consignmentId) {
          this.logger.warn(
            `Order ${payload.orderId} already exists at courier provider (consignmentId: ${existing.consignmentId}) — adopting existing consignment without duplicate creation.`,
          );
          consignment = existing;
        } else if (existing.exists) {
          // Shipment exists at the provider but the provider did not return an identifier
          // we can link. Never create a second one — dead-letter for manual reconciliation.
          throw new NonRetryableOutboxError(
            `RECONCILIATION_REQUIRED: courier shipment for order ${payload.orderId} exists at provider without a linkable consignment id (${existing.message ?? 'no detail'}).`,
          );
        }
      } else if (priorDispatchUncertain) {
        // A 404 does not prove absence: the provider may be eventually consistent and the
        // earlier create may have been accepted. Without provider-side idempotency we must
        // not risk a duplicate shipment — require manual reconciliation (sentinel retained).
        throw new NonRetryableOutboxError(
          `RECONCILIATION_REQUIRED: a previous dispatch for order ${payload.orderId} may have reached the courier but status inquiry returned not-found. Verify in the Steadfast panel, then set consignment_id or reset it to NULL and requeue.`,
        );
      }
    }

    // Atomic claim before external execution (Phase 4 / CONC-24-A)
    // If consignmentId is not yet claimed, atomically set to 'PENDING_DISPATCH' in a short transaction.
    // Any concurrent worker or duplicate request will fail this atomic claim and exit immediately,
    // guaranteeing at most 1 external call to the courier without holding database row locks during HTTP I/O.
    if (!order.consignmentId) {
      const claimed = await this.db
        .update(schema.orders)
        .set({ consignmentId: 'PENDING_DISPATCH', updatedAt: new Date() })
        .where(
          and(
            eq(schema.orders.id, payload.orderId),
            isNull(schema.orders.consignmentId),
          ),
        )
        .returning({ id: schema.orders.id });

      if (claimed.length === 0) {
        this.logger.warn(
          `Order ${payload.orderId} was already claimed by another worker — skipping duplicate external dispatch.`,
        );
        return;
      }
    } else if (order.consignmentId === 'PENDING_DISPATCH') {
      if (event.attempts === 1) {
        // Another concurrent worker is actively dispatching this order right now
        this.logger.warn(
          `Order ${payload.orderId} is currently being dispatched by another worker — skipping concurrent submission.`,
        );
        return;
      }
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

    // Critical financial invariant: if customer already paid online (paymentStatus === 'paid'),
    // COD amountToCollect must be 0, otherwise courier will collect payment a second time!
    const amountToCollect =
      order.paymentStatus === 'paid' ? 0 : parseFloat(order.totalAmount);

    if (!consignment) {
      consignment = await this.courierService.createConsignment({
        orderId: payload.orderId,
        recipientName: user?.fullName ?? 'Customer',
        recipientPhone: user?.phone ?? '0000000',
        recipientAddress: address?.addressLine1 ?? 'Unknown',
        recipientCity: address?.city ?? 'Unknown',
        amountToCollect,
        itemQuantity: totalQuantity,
        itemWeight: 0.5,
      });
    }

    if (!consignment || !consignment.success || !consignment.consignmentId) {
      if (consignment?.ambiguous) {
        // Outcome unknown (timeout / 5xx / accepted-without-id): the shipment may exist.
        // Keep the PENDING_DISPATCH sentinel so a retry inquires the provider and never
        // blindly re-creates.
        throw new Error(
          `Courier create outcome ambiguous for order ${payload.orderId}: ${consignment.message ?? 'unknown'} — sentinel retained for provider reconciliation.`,
        );
      }
      // Definitive provider rejection: safe to release the claim.
      await this.db
        .update(schema.orders)
        .set({ consignmentId: null, updatedAt: new Date() })
        .where(
          and(
            eq(schema.orders.id, payload.orderId),
            eq(schema.orders.consignmentId, 'PENDING_DISPATCH'),
          ),
        );
      throw new Error(
        consignment?.message ?? 'Courier API returned a failure response',
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

    // Queue SMS notification for shipped status
    if (user?.phone) {
      await this.db.insert(schema.outboxEvents).values({
        type: 'SEND_SMS',
        payload: {
          type: 'shipped',
          phone: user.phone,
          orderId: payload.orderId,
          trackingUrl: consignment.trackingUrl ?? '',
        },
      });
    }
  }

  private async markFailed(
    eventId: string,
    error: string,
    expectedAttempts?: number,
  ): Promise<void> {
    const conditions = [eq(schema.outboxEvents.id, eventId)];
    if (expectedAttempts !== undefined) {
      conditions.push(lte(schema.outboxEvents.attempts, expectedAttempts));
    }
    await this.db
      .update(schema.outboxEvents)
      .set({
        status: 'failed',
        lastError: error,
        updatedAt: new Date(),
      })
      .where(and(...conditions));
  }

  private async handleSendOrderConfirmation(
    event: schema.OutboxEvent,
  ): Promise<void> {
    // Payload is self-contained — no extra DB queries needed.
    const payload = event.payload as {
      email: string;
      fullName: string;
      orderId: string;
      items: Array<{
        productName: string;
        quantity: number;
        unitPrice: string;
      }>;
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
      .map((p) => ({ name: p.name, stock: p.stock, threshold: THRESHOLD }));

    if (lowStock.length > 0) {
      await this.mailService.sendLowStockAlert(lowStock);
    }
  }

  private async handleSendSms(event: schema.OutboxEvent): Promise<void> {
    const payload = event.payload as {
      type: 'shipped' | 'delivered';
      phone: string;
      orderId: string;
      trackingUrl?: string;
    };

    let delivered = false;
    if (payload.type === 'shipped') {
      delivered = await this.smsService.sendOrderShippedSms(
        payload.phone,
        payload.orderId,
        payload.trackingUrl,
      );
    } else if (payload.type === 'delivered') {
      delivered = await this.smsService.sendOrderDeliveredSms(
        payload.phone,
        payload.orderId,
      );
    }

    if (!delivered) {
      throw new Error(
        `SMS delivery failed for ${payload.type} notification to ${payload.phone}`,
      );
    }
  }

  private async handleRefundRequired(event: schema.OutboxEvent): Promise<void> {
    const payload = event.payload as {
      orderId: string;
      paymentId?: string;
      amount?: string | number;
      reason?: string;
    };

    const [order] = await this.db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, payload.orderId));

    if (!order) {
      throw new Error(`Order ${payload.orderId} not found`);
    }

    // Idempotency check: if refund request already exists for this order, skip duplicate insert
    const [existingRefund] = await this.db
      .select({ id: schema.refunds.id })
      .from(schema.refunds)
      .where(eq(schema.refunds.orderId, payload.orderId))
      .limit(1);

    if (existingRefund) {
      this.logger.warn(
        `Refund for order ${payload.orderId} already registered (${existingRefund.id}) — skipping duplicate.`,
      );
      return;
    }

    let paymentId = payload.paymentId;
    if (!paymentId) {
      const [latestPayment] = await this.db
        .select({ id: schema.payments.id })
        .from(schema.payments)
        .where(eq(schema.payments.orderId, payload.orderId))
        .orderBy(desc(schema.payments.createdAt))
        .limit(1);
      paymentId = latestPayment?.id;
    }

    const refundAmount = payload.amount
      ? parseFloat(String(payload.amount)).toFixed(2)
      : parseFloat(order.totalAmount).toFixed(2);

    await this.db.insert(schema.refunds).values({
      orderId: payload.orderId,
      paymentId,
      requestedBy: order.userId,
      amount: refundAmount,
      reason: 'other',
      notes:
        payload.reason ||
        'Automated refund request: Order cancelled after payment confirmed',
      adminNotes:
        'Auto-enqueued by OutboxProcessor from REFUND_REQUIRED event. Action required: Process refund with gateway.',
      status: 'requested',
    });

    this.logger.log(
      `REFUND_REQUIRED event ${event.id} processed: created refund record for order ${payload.orderId}`,
    );
  }

  private async handleReconciliationRequired(
    event: schema.OutboxEvent,
  ): Promise<void> {
    const payload = event.payload as {
      orderId: string;
      paymentId?: string;
      transactionId?: string;
      amount?: string | number;
      reason?: string;
    };

    const [order] = await this.db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, payload.orderId));

    if (!order) {
      throw new Error(`Order ${payload.orderId} not found`);
    }

    // Idempotency check: if refund record already exists, skip duplicate insert
    const [existingRefund] = await this.db
      .select({ id: schema.refunds.id })
      .from(schema.refunds)
      .where(eq(schema.refunds.orderId, payload.orderId))
      .limit(1);

    if (existingRefund) {
      this.logger.warn(
        `Reconciliation refund record for order ${payload.orderId} already registered (${existingRefund.id}) — skipping duplicate.`,
      );
      return;
    }

    const reconciliationAmount = payload.amount
      ? parseFloat(String(payload.amount)).toFixed(2)
      : parseFloat(order.totalAmount).toFixed(2);

    await this.db.insert(schema.refunds).values({
      orderId: payload.orderId,
      paymentId: payload.paymentId,
      requestedBy: order.userId,
      amount: reconciliationAmount,
      reason: 'other',
      notes:
        payload.reason ||
        `Late payment received on cancelled order (Tran ID: ${payload.transactionId ?? 'N/A'})`,
      adminNotes: `RECONCILIATION_REQUIRED: Payment confirmed by gateway after order was cancelled. Gateway Tran: ${payload.transactionId ?? 'N/A'}. Action needed: Refund customer or fulfill manually.`,
      status: 'requested',
    });

    this.logger.warn(
      `RECONCILIATION_REQUIRED event ${event.id} processed: logged actionable refund item for order ${payload.orderId}`,
    );
  }

  private async handleSendAbandonedCartEmail(
    event: schema.OutboxEvent,
  ): Promise<void> {
    const payload = event.payload as {
      userId: string;
      email: string;
      fullName: string;
      items: Array<{
        productName: string;
        quantity: number;
        unitPrice: string;
      }>;
    };

    // In-flight Checkout Safety Guard (CONC-19-J):
    // Check if user still has items in their cart. If user completed checkout
    // or cleared their cart, OrdersService already deleted their cart items.
    const [activeCartItem] = await this.db
      .select({ id: schema.cartItems.id })
      .from(schema.cartItems)
      .where(eq(schema.cartItems.userId, payload.userId))
      .limit(1);

    if (!activeCartItem) {
      this.logger.log(
        `User ${payload.userId} cart was emptied or checked out before email dispatch — skipping abandoned cart email.`,
      );
      return;
    }

    await this.mailService.sendAbandonedCartEmail(
      payload.email,
      payload.fullName,
      payload.items,
    );
  }
}
