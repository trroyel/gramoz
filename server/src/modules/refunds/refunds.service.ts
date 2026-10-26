import { Injectable, Logger } from '@nestjs/common';
import {
  EntityNotFoundError,
  InvalidOperationError,
  ForbiddenOperationError,
} from '../../common/errors/domain.errors';
import * as schema from '@database/schema';
import { RefundsStore } from './refunds.store';
import {
  PaymentsService,
  RefundInitiationResult,
  RefundInquiryResult,
} from '../payments/payments.service';
import { LoyaltyService } from '../loyalty/loyalty.service';

export type RefundReason =
  | 'damaged_item'
  | 'wrong_item'
  | 'not_received'
  | 'quality_issue'
  | 'changed_mind'
  | 'other';

export interface RequestRefundDto {
  orderId: string;
  paymentId?: string;
  amount: number;
  reason: RefundReason;
  notes?: string;
}

export interface ProcessRefundDto {
  status: 'approved' | 'processing' | 'processed' | 'rejected';
  adminNotes?: string;
  gatewayRefundId?: string;
}

@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    private readonly refundsStore: RefundsStore,
    private readonly paymentsService: PaymentsService,
    private readonly loyaltyService: LoyaltyService,
  ) {}

  /**
   * Customer requests a refund for a delivered/completed order.
   * Only allowed if: order exists, belongs to user, and order is delivered.
   * One refund per order — prevents duplicate requests.
   * Validates positive amount <= order total.
   * Resolves authoritative paymentId.
   */
  async requestRefund(userId: string, dto: RequestRefundDto) {
    if (
      typeof dto.amount !== 'number' ||
      isNaN(dto.amount) ||
      dto.amount <= 0
    ) {
      throw new InvalidOperationError(
        'Refund amount must be a positive number',
      );
    }

    // 2-decimal rounded precision arithmetic
    const roundedAmount = Math.round(dto.amount * 100) / 100;

    const order = await this.refundsStore.findOrderById(dto.orderId);
    if (!order) {
      throw new EntityNotFoundError('Order not found');
    }

    if (order.userId !== userId) {
      throw new ForbiddenOperationError(
        'You can only request a refund for your own orders',
      );
    }

    // Only delivered orders can be requested by customers
    if (order.status !== 'delivered') {
      throw new InvalidOperationError(
        'Refunds can only be requested for delivered orders',
      );
    }

    // Prevent duplicate active refund requests (rejected requests may be re-submitted per Phase 8)
    const existing = await this.refundsStore.findActiveRefundByOrderId(
      dto.orderId,
    );
    if (existing) {
      throw new InvalidOperationError(
        'A refund request already exists for this order',
      );
    }

    // Validate refund amount does not exceed the order total
    const orderTotal = parseFloat(order.totalAmount);
    if (roundedAmount > orderTotal) {
      throw new InvalidOperationError(
        `Refund amount (${roundedAmount}) cannot exceed order total (${orderTotal.toFixed(2)})`,
      );
    }

    // Resolve authoritative paymentId from order's completed payment
    const completedPayment =
      await this.refundsStore.findCompletedPaymentByOrderId(dto.orderId);
    const authoritativePaymentId =
      completedPayment?.id || dto.paymentId || null;

    try {
      const refund = await this.refundsStore.createRefund({
        orderId: dto.orderId,
        paymentId: authoritativePaymentId,
        requestedBy: userId,
        amount: roundedAmount.toFixed(2),
        reason: dto.reason,
        notes: dto.notes,
        status: 'requested',
      });
      return refund;
    } catch (err: any) {
      // Catch concurrent unique index violation (uq_refunds_order_id)
      if (
        err?.code === '23505' ||
        err?.message?.includes('duplicate key') ||
        err?.message?.includes('uq_refunds_order_id')
      ) {
        throw new InvalidOperationError(
          'A refund request already exists for this order',
        );
      }
      throw err;
    }
  }

  /**
   * Admin: list all refund requests with order and customer info.
   */
  async getAllRefunds(status?: schema.Refund['status'], page = 1, limit = 20) {
    const offset = (Math.max(1, page) - 1) * Math.min(100, limit);
    return await this.refundsStore.getAllRefunds(status, limit, offset);
  }

  /**
   * Admin: get a single refund with full details.
   */
  async getRefundById(id: string) {
    const refund = await this.refundsStore.findRefundById(id);
    if (!refund) throw new EntityNotFoundError('Refund not found');
    return refund;
  }

  /**
   * Admin: approve, process, or reject a refund request.
   * Concurrency-safe with canonical locking:
   * Level 1: orders -> Level 2: payments -> Level 3: refunds.
   * Prevents double restocking, duplicate loyalty point restoration,
   * duplicate external gateway initiations (via short-transaction atomic claim),
   * premature settlement claims, and phantom variant inventory drift.
   */
  async processRefund(
    adminId: string,
    refundId: string,
    dto: ProcessRefundDto,
  ) {
    const existingRefund = await this.refundsStore.findRefundById(refundId);
    if (!existingRefund) {
      throw new EntityNotFoundError('Refund not found');
    }

    if (
      existingRefund.status === 'processed' ||
      existingRefund.status === 'rejected'
    ) {
      throw new InvalidOperationError(
        'Refund request has already been processed',
      );
    }

    if (existingRefund.status === 'processing' && !dto.gatewayRefundId) {
      throw new InvalidOperationError(
        'Refund is currently being processed with payment provider',
      );
    }

    // ─── ADMIN ACTION: APPROVED or REJECTED (Local Administrative Decisions) ──
    if (dto.status === 'approved' || dto.status === 'rejected') {
      return await this.refundsStore.runTransaction(async (tx) => {
        // Canonical locking: Level 1 orders -> Level 2 payments -> Level 3 refunds
        await this.refundsStore.findOrderByIdForUpdate(
          existingRefund.orderId,
          tx,
        );
        if (existingRefund.paymentId) {
          await this.refundsStore.findPaymentByIdForUpdate(
            existingRefund.paymentId,
            tx,
          );
        }
        const lockedRefund = await this.refundsStore.findRefundByIdForUpdate(
          refundId,
          tx,
        );
        if (!lockedRefund) {
          throw new EntityNotFoundError('Refund not found');
        }
        if (
          lockedRefund.status === 'processed' ||
          lockedRefund.status === 'rejected'
        ) {
          throw new InvalidOperationError(
            'Refund request has already been processed',
          );
        }

        return await this.refundsStore.updateRefund(
          refundId,
          {
            status: dto.status,
            adminNotes: dto.adminNotes,
            gatewayRefundId:
              dto.gatewayRefundId || lockedRefund.gatewayRefundId,
            processedBy: adminId,
          },
          tx,
        );
      });
    }

    // ─── ADMIN ACTION: PROCESSED (Financial Refund Payout) ───────────────────
    let payment = null;
    if (existingRefund.paymentId) {
      payment = await this.refundsStore.findPaymentById(
        existingRefund.paymentId,
      );
    }

    const isOnline =
      payment &&
      payment.status === 'completed' &&
      payment.method?.toUpperCase() !== 'COD';

    let gatewayRefundId = dto.gatewayRefundId || existingRefund.gatewayRefundId;

    // Handle Cash on Delivery (COD) refunds:
    if (!isOnline && dto.status === 'processed') {
      if (!dto.gatewayRefundId && !dto.adminNotes) {
        throw new InvalidOperationError(
          'COD refund requires a recorded settlement reference or reimbursement acknowledgment (e.g. MFS transaction ID, bank receipt, or cash voucher)',
        );
      }
      gatewayRefundId =
        dto.gatewayRefundId ||
        existingRefund.gatewayRefundId ||
        `COD-MANUAL-${refundId}`;
    }

    let performedAtomicClaim = false;

    // Handle Online Payments requiring external SSLCommerz initiation:
    if (isOnline && dto.status === 'processed' && !gatewayRefundId) {
      // ─── STEP 1: SHORT DB TRANSACTION (ATOMIC CLAIM) ──────────────────────
      // Transition status to 'processing' before making external HTTP call.
      // This guarantees that concurrent workers/admins cannot invoke the provider API simultaneously!
      await this.refundsStore.runTransaction(async (tx) => {
        const lockedRefund = await this.refundsStore.findRefundByIdForUpdate(
          refundId,
          tx,
        );
        if (!lockedRefund) {
          throw new EntityNotFoundError('Refund not found');
        }
        if (
          lockedRefund.status === 'processed' ||
          lockedRefund.status === 'rejected'
        ) {
          throw new InvalidOperationError(
            'Refund request has already been processed',
          );
        }
        if (lockedRefund.status === 'processing') {
          throw new InvalidOperationError(
            'Refund is currently being processed with payment provider',
          );
        }

        await this.refundsStore.updateRefund(
          refundId,
          {
            status: 'processing',
            processedBy: adminId,
            adminNotes: dto.adminNotes
              ? `${dto.adminNotes} [In-flight gateway claim]`
              : 'In-flight gateway claim',
          },
          tx,
        );
        performedAtomicClaim = true;
      });

      // ─── STEP 2: EXTERNAL PROVIDER CALL (OUTSIDE DB LOCKS) ────────────────
      let refundResult: RefundInitiationResult;
      try {
        refundResult = await this.paymentsService.initiateRefund({
          paymentId: payment.id,
          amount: parseFloat(existingRefund.amount),
          reason: existingRefund.reason,
          refundId: existingRefund.id,
        });
      } catch (err: any) {
        this.logger.error(
          `Gateway refund initiation threw exception for refund ${refundId}: ${err.message}`,
        );
        refundResult = {
          success: false,
          status: 'processing',
          errorReason: `Provider exception: ${err.message}`,
        };
      }

      if (refundResult.status === 'failed') {
        await this.refundsStore.updateRefund(refundId, {
          status: 'rejected',
          adminNotes: `Gateway refund rejected by provider: ${refundResult.errorReason || 'Unknown error'}`,
          processedBy: adminId,
        });
        throw new InvalidOperationError(
          `Gateway refund rejected by provider: ${refundResult.errorReason || 'Unknown error'}`,
        );
      }

      if (
        refundResult.status === 'initiated' ||
        refundResult.status === 'processing'
      ) {
        // INVARIANT (TASK-22G Phase 2 & REF-G01):
        // Initiation success does NOT establish final financial settlement!
        // Refund remains in 'processing' status with captured gateway reference.
        // Order, payment, and inventory are NOT modified until authoritative settlement confirmation.
        const updated = await this.refundsStore.updateRefund(refundId, {
          status: 'processing',
          gatewayRefundId: refundResult.refundRefId,
          adminNotes: `Gateway refund initiated successfully (ref: ${refundResult.refundRefId || 'N/A'}). Pending authoritative settlement confirmation.`,
          processedBy: adminId,
        });
        return updated;
      }

      // If transport_error / timeout:
      await this.refundsStore.updateRefund(refundId, {
        status: 'processing',
        adminNotes: `Gateway refund initiation timed out or network error: ${refundResult.errorReason || 'Transport error'}. Marked processing for reconciliation.`,
        processedBy: adminId,
      });
      throw new InvalidOperationError(
        'Gateway refund initiation timed out or network error. Marked as processing for authoritative reconciliation.',
      );
    }

    // ─── STEP 3: FINAL SETTLEMENT TRANSACTION ─────────────────────────────
    // Canonical lock hierarchy: Level 1 orders -> Level 2 payments -> Level 3 refunds
    return await this.refundsStore.runTransaction(async (tx) => {
      const order = await this.refundsStore.findOrderByIdForUpdate(
        existingRefund.orderId,
        tx,
      );
      if (!order) {
        throw new EntityNotFoundError('Linked order not found');
      }

      let lockedPayment = null;
      if (existingRefund.paymentId) {
        lockedPayment = await this.refundsStore.findPaymentByIdForUpdate(
          existingRefund.paymentId,
          tx,
        );
      }

      const lockedRefund = await this.refundsStore.findRefundByIdForUpdate(
        refundId,
        tx,
      );
      if (!lockedRefund) {
        throw new EntityNotFoundError('Refund not found');
      }

      if (
        lockedRefund.status === 'processed' ||
        lockedRefund.status === 'rejected'
      ) {
        throw new InvalidOperationError(
          'Refund request has already been processed',
        );
      }

      if (
        !dto.gatewayRefundId &&
        !performedAtomicClaim &&
        lockedRefund.status === 'processing'
      ) {
        throw new InvalidOperationError(
          'Refund is currently being processed with payment provider',
        );
      }

      // 1. Update Payment status
      if (lockedPayment) {
        await this.refundsStore.updatePaymentStatus(
          lockedPayment.id,
          { status: 'refunded' },
          tx,
        );
      }

      // 2. Update Order status
      await this.refundsStore.updateOrderStatus(
        order.id,
        {
          paymentStatus: 'refunded',
          status: 'refunded' as any,
        },
        tx,
      );

      // 3. Restock inventory IF AND ONLY IF not already restocked
      const wasCancelled = order.status === 'cancelled';
      const orderRestocked = await this.refundsStore.hasOrderBeenRestocked(
        order.id,
        tx,
      );
      const refundRestocked = await this.refundsStore.hasRefundBeenRestocked(
        refundId,
        tx,
      );

      if (!wasCancelled && !orderRestocked && !refundRestocked) {
        const items = await this.refundsStore.getOrderItems(order.id, tx);

        // Damaged item return: quarantine in inventory transactions; NEVER increase saleable stock
        if (lockedRefund.reason === 'damaged_item') {
          for (const item of items) {
            await this.refundsStore.createInventoryTransaction(
              {
                productId: item.productId,
                type: 'in',
                quantity: item.quantity,
                referenceId: refundId,
                notes: 'Damaged item return — not added to saleable stock',
              },
              tx,
            );
          }
        } else {
          // Saleable items: restock variant or quarantine if variant identity was lost
          for (const item of items) {
            if (item.variantId) {
              const variant = await this.refundsStore.findVariantById(
                item.variantId,
                tx,
              );
              if (variant) {
                await this.refundsStore.restockVariant(
                  item.variantId,
                  item.quantity,
                  tx,
                );
                await this.refundsStore.createInventoryTransaction(
                  {
                    productId: item.productId,
                    type: 'in',
                    quantity: item.quantity,
                    referenceId: refundId,
                    notes: 'Refund processed',
                  },
                  tx,
                );
              } else {
                // Variant deleted/recreated during catalog updates:
                // Do NOT silently restock parent product stock (prevents phantom stock drift)
                this.logger.warn(
                  `Variant ${item.variantId} not found in catalog (identity lost). Restocking skipped to prevent phantom inventory; quarantined in inventoryTransactions for warehouse reconciliation.`,
                );
                await this.refundsStore.createInventoryTransaction(
                  {
                    productId: item.productId,
                    type: 'in',
                    quantity: item.quantity,
                    referenceId: refundId,
                    notes: `Variant ${item.variantId} missing — quarantined for warehouse reconciliation (not added to saleable stock)`,
                  },
                  tx,
                );
              }
            } else {
              // Product without variants: restock parent product stock
              await this.refundsStore.restockProduct(
                item.productId,
                item.quantity,
                tx,
              );
              await this.refundsStore.createInventoryTransaction(
                {
                  productId: item.productId,
                  type: 'in',
                  quantity: item.quantity,
                  referenceId: refundId,
                  notes: 'Refund processed',
                },
                tx,
              );
            }
          }
        }
      }

      // 4. Restore Loyalty Points if spent on order and not yet refunded
      const pointsSpent = await this.refundsStore.getPointsSpentOnOrder(
        order.id,
        tx,
      );
      if (pointsSpent > 0) {
        const pointsAlreadyRefunded =
          await this.refundsStore.hasPointsBeenRefunded(order.id, tx);
        if (!pointsAlreadyRefunded) {
          await this.loyaltyService.refundPoints(
            order.userId,
            pointsSpent,
            order.id,
            tx,
          );
        }
      }

      // 5. Update Refund record to 'processed'
      const updated = await this.refundsStore.updateRefund(
        refundId,
        {
          status: 'processed',
          adminNotes: dto.adminNotes || lockedRefund.adminNotes,
          gatewayRefundId:
            gatewayRefundId ||
            dto.gatewayRefundId ||
            lockedRefund.gatewayRefundId,
          processedBy: adminId,
        },
        tx,
      );

      return updated;
    });
  }

  /**
   * Admin: reconcile an in-flight refund with the external payment gateway.
   * Authoritatively queries gateway status and synchronizes the local ledger.
   * Enforces official contract: final settlement requires status: 'refunded'.
   * Handles REF-G02 through REF-G09 invariants.
   */
  async reconcileRefund(adminId: string, refundId: string) {
    const refund = await this.refundsStore.findRefundById(refundId);
    if (!refund) throw new EntityNotFoundError('Refund not found');

    if (refund.status === 'processed') {
      return refund;
    }

    if (!refund.gatewayRefundId) {
      throw new InvalidOperationError(
        'Refund has no gateway reference ID. Manual reconciliation required.',
      );
    }

    // Retrieve linked payment for authoritative transaction identity validation
    let payment = null;
    if (refund.paymentId) {
      payment = await this.refundsStore.findPaymentById(refund.paymentId);
    }
    const gatewayResp = payment?.gatewayResponse || {};
    const expectedBankTranId =
      gatewayResp.bank_tran_id || gatewayResp.val_id || payment?.transactionId;
    const expectedTranId = payment?.transactionId;

    const inquiry: RefundInquiryResult =
      await this.paymentsService.queryRefundStatus(refund.gatewayRefundId, {
        expectedBankTranId,
        expectedTranId,
      });

    if (inquiry.status === 'refunded') {
      // Authoritative settlement confirmed by SSLCommerz!
      try {
        return await this.processRefund(adminId, refundId, {
          status: 'processed',
          gatewayRefundId: refund.gatewayRefundId,
          adminNotes: `Reconciled via gateway inquiry — settlement confirmed (bank_tran_id: ${inquiry.bankTranId || 'confirmed'}, refunded_on: ${inquiry.refundedOn || 'confirmed'})`,
        });
      } catch (err: any) {
        if (
          err instanceof InvalidOperationError &&
          err.message.includes('already been processed')
        ) {
          // Idempotent recovery for concurrent reconciliation (REF-G09)
          const latest = await this.refundsStore.findRefundById(refundId);
          return latest || refund;
        }
        throw err;
      }
    } else if (inquiry.status === 'cancelled') {
      return await this.refundsStore.updateRefund(refundId, {
        status: 'rejected',
        adminNotes: `Gateway inquiry confirmed cancellation: ${inquiry.errorReason || 'Cancelled by provider/bank'}`,
        processedBy: adminId,
      });
    } else if (inquiry.status === 'processing') {
      return await this.refundsStore.updateRefund(refundId, {
        status: 'processing',
        adminNotes: `Gateway inquiry: still processing with provider/bank (${inquiry.bankTranId || 'in-flight'})`,
        processedBy: adminId,
      });
    } else {
      // Fail closed on failed_auth, invalid_identity, unknown_status, transport_error
      return await this.refundsStore.updateRefund(refundId, {
        status: 'processing',
        adminNotes: `Gateway inquiry unresolved [${inquiry.status}]: ${inquiry.errorReason || 'Unconfirmed settlement'}`,
        processedBy: adminId,
      });
    }
  }

  /**
   * Customer: get their own refund requests.
   */
  async getMyRefunds(userId: string) {
    return await this.refundsStore.getMyRefunds(userId);
  }
}
