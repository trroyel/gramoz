import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OrdersStore } from './orders.store';
import { OrdersService } from './orders.service';
import { SettingsService } from '../settings/settings.service';

/**
 * OrdersExpiryProcessor — Stale Checkout & Unpaid Order Expiry Worker
 *
 * Runs periodically to scan for abandoned online checkout sessions that have
 * reserved inventory without completing payment.
 *
 * Safety & Invariant Rules:
 *  1. Only targets orders with status = 'pending'.
 *  2. EXCLUDES Cash On Delivery (COD) orders — COD orders remain unpaid until delivery.
 *  3. EXCLUDES already-paid orders (paymentStatus = 'paid').
 *  4. EXCLUDES active in-flight payments updated within buffer window (protects active user checkout).
 *  5. Uses PostgreSQL `FOR UPDATE SKIP LOCKED` to ensure exactly-once processing across multi-pod deploys.
 *  6. Atomically releases reserved inventory (both products & variants) and cancels the order.
 */
@Injectable()
export class OrdersExpiryProcessor {
  private readonly logger = new Logger(OrdersExpiryProcessor.name);

  constructor(
    private readonly ordersStore: OrdersStore,
    private readonly ordersService: OrdersService,
    private readonly settingsService: SettingsService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async processStaleCheckoutExpiry(): Promise<number> {
    try {
      const expiryMinutes =
        await this.settingsService.getCheckoutExpiryMinutes();

      const candidateOrders =
        await this.ordersStore.findStaleUnpaidOrdersForExpiry(expiryMinutes);

      if (candidateOrders.length === 0) {
        return 0;
      }

      this.logger.log(
        `Found ${candidateOrders.length} stale unpaid order(s) eligible for automated expiry (> ${expiryMinutes}m old).`,
      );

      let expiredCount = 0;
      for (const candidate of candidateOrders) {
        try {
          await this.ordersService.expireOrder(
            candidate.id,
            `Automated checkout expiry (unpaid after ${expiryMinutes}m)`,
          );
          expiredCount++;
          this.logger.log(
            `Order ${candidate.id} successfully expired and inventory restored.`,
          );
        } catch (err: unknown) {
          const errMsg =
            err instanceof Error
              ? err.message
              : typeof err === 'string'
                ? err
                : JSON.stringify(err);
          const errStack = err instanceof Error ? err.stack : undefined;
          this.logger.error(
            `Failed to expire stale order ${candidate.id}: ${errMsg}`,
            errStack,
          );
        }
      }

      return expiredCount;
    } catch (err: unknown) {
      const errMsg =
        err instanceof Error
          ? err.message
          : typeof err === 'string'
            ? err
            : JSON.stringify(err);
      const errStack = err instanceof Error ? err.stack : undefined;
      this.logger.error(
        `Error executing stale checkout expiry processor: ${errMsg}`,
        errStack,
      );
      return 0;
    }
  }
}
