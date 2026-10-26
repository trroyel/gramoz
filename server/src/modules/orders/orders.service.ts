import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import {
  EntityNotFoundError,
  InvalidOperationError,
  InsufficientStockError,
  ForbiddenOperationError,
} from '../../common/errors/domain.errors';
import * as schema from '@database/schema';
import { CreateOrderDto } from './dto/create-order.dto';
import { PromosService } from '../promos/promos.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { SettingsService } from '../settings/settings.service';
import { CourierService } from '../courier/courier.service';
import { OrdersStore } from './orders.store';

export const ORDER_STATE_TRANSITIONS: Record<
  schema.Order['status'],
  schema.Order['status'][]
> = {
  pending: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['out_for_delivery', 'delivered'],
  out_for_delivery: ['delivered'],
  delivered: ['refunded'],
  cancelled: [],
  refunded: [],
};

@Injectable()
export class OrdersService {
  constructor(
    private readonly ordersStore: OrdersStore,
    private readonly promosService: PromosService,
    private readonly loyaltyService: LoyaltyService,
    private readonly settingsService: SettingsService,
    private readonly courierService: CourierService,
  ) {}

  async createOrderFromCart(
    userId: string,
    dto: CreateOrderDto,
    idempotencyKey?: string,
  ): Promise<schema.Order> {
    const trimmedKey =
      idempotencyKey?.trim() || dto.idempotencyKey?.trim() || null;

    // Phase 4: Request hash normalization to detect parameter tampering on key reuse
    const normalizedPayload = {
      addressLine1: dto.addressLine1?.trim(),
      city: dto.city?.trim(),
      phone: dto.phone?.trim(),
      promoCode: dto.promoCode?.trim().toUpperCase() || null,
      usePoints: !!dto.usePoints,
      zoneId: dto.zoneId || null,
      deliveryMethod: dto.deliveryMethod || 'home',
    };
    const requestHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(normalizedPayload))
      .digest('hex');

    // Phase 3 & TASK-10: Pre-compute delivery charge outside write transaction
    let precomputedDeliveryCharge: number | null = null;
    if (dto.zoneId && dto.deliveryMethod) {
      const cartCount = await this.ordersStore.getCartItemsCount(userId);
      if (cartCount > 0) {
        const totalWeight = cartCount * 0.5;
        const calc = await this.courierService.calculateCharge(
          dto.zoneId,
          dto.deliveryMethod,
          totalWeight,
        );
        precomputedDeliveryCharge = calc.charge;
      }
    }

    const result = await this.ordersStore.runTransaction(async (tx) => {
      // 1. Transaction-scoped user checkout advisory lock serializes concurrent checkouts by same user
      await this.ordersStore.acquireUserCheckoutLock(userId, tx);

      // 2. Database-backed Idempotency Check
      let existingIdempotencyRecord: schema.IdempotencyKey | null = null;
      if (trimmedKey) {
        existingIdempotencyRecord =
          await this.ordersStore.findIdempotencyKeyForUpdate(
            userId,
            trimmedKey,
            tx,
          );

        if (existingIdempotencyRecord) {
          if (existingIdempotencyRecord.requestHash !== requestHash) {
            throw new InvalidOperationError(
              'Idempotency key has already been used with different request parameters',
            );
          }

          if (
            existingIdempotencyRecord.status === 'completed' &&
            existingIdempotencyRecord.orderId
          ) {
            const existingOrder = await this.ordersStore.findOrderById(
              existingIdempotencyRecord.orderId,
              tx,
            );
            if (existingOrder) {
              return { order: existingOrder, isReplay: true };
            }
          }

          if (existingIdempotencyRecord.status === 'started') {
            throw new InvalidOperationError(
              'A checkout request with this idempotency key is currently in progress',
            );
          }
        } else {
          const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours retention
          existingIdempotencyRecord =
            await this.ordersStore.createIdempotencyKey(
              {
                userId,
                key: trimmedKey,
                endpoint: 'POST /orders/checkout',
                requestHash,
                status: 'started',
                expiresAt,
              },
              tx,
            );
        }
      }

      // 3. Fetch cart items and user basic info concurrently upfront to minimize lock hold duration
      const [cartItems, user] = await Promise.all([
        this.ordersStore.getCartItemsWithProducts(userId, tx),
        this.ordersStore.getUserBasicInfo(userId, tx),
      ]);

      if (cartItems.length === 0) {
        throw new InvalidOperationError('Your cart is empty');
      }

      // 4. Initial stock verification
      for (const item of cartItems) {
        const stock = item.variantId
          ? (item.variantStock ?? 0)
          : (item.productStock ?? 0);
        if (stock < item.quantity) {
          throw new InsufficientStockError(
            `Insufficient stock for "${item.productName}". Available: ${stock}`,
          );
        }
      }

      // 5. Canonical Deadlock-Free Lock Ordering (sort by variantId || productId)
      const sortedCartItems = [...cartItems].sort((a, b) => {
        const idA = a.variantId ?? a.productId ?? '';
        const idB = b.variantId ?? b.productId ?? '';
        return idA.localeCompare(idB);
      });

      // 6. Authoritative Pricing Calculation
      let totalAmount =
        sortedCartItems.reduce((sum, item) => {
          const priceStr = item.variantPrice ?? item.productPrice ?? '0';
          const priceInCents = Math.round(parseFloat(priceStr) * 100);
          return sum + priceInCents * item.quantity;
        }, 0) / 100;

      let appliedPromoId: string | null = null;
      let discountAmount = 0;

      if (dto.promoCode) {
        const promoResult = await this.promosService.validate({
          code: dto.promoCode,
          subtotal: totalAmount,
        });
        appliedPromoId = promoResult.promoId;
        discountAmount += promoResult.discountAmount;
        totalAmount -= promoResult.discountAmount;
      }

      let pointsSpent = 0;
      if (dto.usePoints) {
        const balance = await this.loyaltyService.getBalance(userId);
        const ratio = await this.settingsService.getPointsToCurrencyRatio();
        const maxPointsValue = balance / ratio;

        let pointsToUse = 0;
        let pointsValue = 0;

        if (maxPointsValue >= totalAmount) {
          pointsValue = totalAmount;
          pointsToUse = Math.ceil(totalAmount * ratio);
        } else {
          pointsValue = maxPointsValue;
          pointsToUse = balance;
        }

        if (pointsToUse > 0) {
          pointsSpent = pointsToUse;
          discountAmount += pointsValue;
          totalAmount -= pointsValue;
        }
      }

      discountAmount = Math.round(discountAmount * 100) / 100;
      totalAmount = Math.max(0, Math.round(totalAmount * 100) / 100);

      let deliveryCharge = precomputedDeliveryCharge ?? 0;
      if (
        dto.zoneId &&
        dto.deliveryMethod &&
        precomputedDeliveryCharge === null
      ) {
        const totalWeight = sortedCartItems.length * 0.5;
        const calc = await this.courierService.calculateCharge(
          dto.zoneId,
          dto.deliveryMethod,
          totalWeight,
        );
        deliveryCharge = calc.charge;
      }

      const existingAddress = await this.ordersStore.findAddress(
        userId,
        dto.addressLine1,
        dto.city,
        tx,
      );

      let address: schema.Address;
      if (existingAddress) {
        if (dto.zoneId && !existingAddress.zoneId) {
          address = await this.ordersStore.updateAddressZone(
            existingAddress.id,
            dto.zoneId,
            tx,
          );
        } else {
          address = existingAddress;
        }
      } else {
        address = await this.ordersStore.createAddress(
          {
            userId,
            title: 'Shipping Address',
            addressLine1: dto.addressLine1,
            city: dto.city,
            latitude: dto.latitude,
            longitude: dto.longitude,
            zoneId: dto.zoneId,
            isDefault: false,
          },
          tx,
        );
      }

      const order = await this.ordersStore.createOrder(
        {
          userId,
          shippingAddressId: address.id,
          totalAmount: (totalAmount + deliveryCharge).toFixed(2),
          deliveryCharge: deliveryCharge.toFixed(2),
          deliveryMethod: dto.deliveryMethod || 'home',
          status: 'pending',
          paymentStatus: 'unpaid',
          promoId: appliedPromoId,
          discountAmount: discountAmount.toString(),
          idempotencyKey: trimmedKey,
        },
        tx,
      );

      // 7. Atomic stock deduction in sorted canonical order
      for (const item of sortedCartItems) {
        let stockUpdated = false;
        if (item.variantId) {
          stockUpdated = await this.ordersStore.deductVariantStock(
            item.variantId,
            item.quantity,
            tx,
          );
        } else {
          stockUpdated = await this.ordersStore.deductProductStock(
            item.productId,
            item.quantity,
            tx,
          );
        }

        if (!stockUpdated) {
          throw new InsufficientStockError(
            `"${item.productName}" just sold out. Please remove it from your cart.`,
          );
        }
      }

      // 8. Batch Insert Order Items and Inventory Transactions (drastically reduces round-trips while holding locks)
      const orderItemInputs = sortedCartItems.map((item) => ({
        orderId: order.id,
        productId: item.productId,
        variantId: item.variantId,
        variantAttributes: item.variantAttributes,
        quantity: item.quantity,
        unitPrice: item.variantPrice ?? item.productPrice ?? '0',
      }));

      if (typeof this.ordersStore.createOrderItems === 'function') {
        await this.ordersStore.createOrderItems(orderItemInputs, tx);
      } else {
        for (const input of orderItemInputs) {
          await this.ordersStore.createOrderItem(input, tx);
        }
      }

      const inventoryTxInputs = sortedCartItems.map((item) => ({
        productId: item.productId,
        type: 'out' as const,
        quantity: item.quantity,
        referenceId: order.id,
        notes: `Order placed`,
      }));

      if (typeof this.ordersStore.createInventoryTransactions === 'function') {
        await this.ordersStore.createInventoryTransactions(
          inventoryTxInputs,
          tx,
        );
      } else {
        for (const input of inventoryTxInputs) {
          await this.ordersStore.createInventoryTransaction(input, tx);
        }
      }

      // 9. Delete checked-out cart items inside transaction (preserving any newly added items)
      const cartItemIds = sortedCartItems
        .map((item) => item.id)
        .filter(Boolean);
      if (typeof this.ordersStore.deleteCartItemsByIds === 'function') {
        await this.ordersStore.deleteCartItemsByIds(cartItemIds, userId, tx);
      } else {
        await this.ordersStore.deleteCartItemsByUserId(userId, tx);
      }

      // 10. Increment promo usage
      if (appliedPromoId) {
        const updatedPromo = await this.ordersStore.incrementPromoUsage(
          appliedPromoId,
          tx,
        );
        if (!updatedPromo) {
          throw new InvalidOperationError(
            'This promo code just reached its usage limit. Please try without a promo code.',
          );
        }
      }

      // 11. Loyalty points deduction
      if (pointsSpent > 0) {
        await this.loyaltyService.spendPoints(
          userId,
          pointsSpent,
          order.id,
          tx,
        );
      }

      // 12. Batch Transactional Outbox Events
      const outboxEvents: (typeof schema.outboxEvents.$inferInsert)[] = [];
      if (user) {
        const emailItems = sortedCartItems.map((i) => ({
          productName: i.productName ?? 'Product',
          quantity: i.quantity,
          unitPrice: i.productPrice ?? '0',
        }));
        outboxEvents.push({
          type: 'SEND_ORDER_CONFIRMATION',
          payload: {
            email: user.email,
            fullName: user.fullName,
            orderId: order.id,
            items: emailItems,
            totalAmount: order.totalAmount,
          },
        });
      }

      outboxEvents.push({
        type: 'SEND_LOW_STOCK_ALERT',
        payload: { productIds: sortedCartItems.map((i) => i.productId) },
      });

      if (typeof this.ordersStore.createOutboxEvents === 'function') {
        await this.ordersStore.createOutboxEvents(outboxEvents, tx);
      } else {
        for (const event of outboxEvents) {
          await this.ordersStore.createOutboxEvent(event, tx);
        }
      }

      // 13. Complete Idempotency Record
      if (trimmedKey && existingIdempotencyRecord) {
        await this.ordersStore.updateIdempotencyKey(
          existingIdempotencyRecord.id,
          {
            status: 'completed',
            orderId: order.id,
            responsePayload: {
              id: order.id,
              totalAmount: order.totalAmount,
              status: order.status,
              paymentStatus: order.paymentStatus,
              createdAt: order.createdAt,
            },
          },
          tx,
        );
      }

      return { order, items: sortedCartItems, user };
    });

    return result.order;
  }

  async getUserOrders(userId: string, page = 1, limit = 10): Promise<any[]> {
    const offset = (Math.max(1, page) - 1) * Math.min(50, limit);
    const ordersWithPayments = await this.ordersStore.getUserOrdersWithPayments(
      userId,
      limit,
      offset,
    );

    return ordersWithPayments.map((order) => ({
      ...order,
      payment: order.payments[0] || null,
      payments: undefined,
    }));
  }

  async getOrderDetails(userId: string, orderId: string): Promise<any> {
    const order = await this.ordersStore.getOrderDetailsWithPayments(
      userId,
      orderId,
    );

    if (!order) {
      throw new EntityNotFoundError('Order not found');
    }

    const items = await this.ordersStore.getOrderItemsWithProducts(orderId);

    const { payments, ...orderData } = order;
    return { ...orderData, payment: payments[0] || null, items };
  }

  async getOrderDetailsAsAdmin(orderId: string): Promise<any> {
    const order = await this.ordersStore.getOrderDetailsAsAdmin(orderId);

    if (!order) {
      throw new EntityNotFoundError('Order not found');
    }

    const items = await this.ordersStore.getOrderItemsWithProducts(orderId);
    const payment = await this.ordersStore.getLatestPaymentByOrderId(orderId);

    return { ...order, items, payment };
  }

  async getAllOrdersAsAdmin(page = 1, limit = 20): Promise<any[]> {
    const offset = (Math.max(1, page) - 1) * Math.min(100, limit);
    const ordersWithRelations =
      await this.ordersStore.getAllOrdersWithRelationsAsAdmin(limit, offset);

    return ordersWithRelations.map((order) => {
      const { user, payments, ...orderData } = order;
      return {
        ...orderData,
        customerName: user?.fullName,
        payment: payments[0] || null,
      };
    });
  }

  async cancelOrder(
    userId: string,
    orderId: string,
    reason?: string,
  ): Promise<schema.Order> {
    const order = await this.ordersStore.findOrderById(orderId);
    if (!order) {
      throw new EntityNotFoundError('Order not found');
    }
    if (order.userId !== userId) {
      throw new ForbiddenOperationError('You can only cancel your own orders');
    }
    if (order.status === 'cancelled') {
      throw new InvalidOperationError('Order is already cancelled');
    }
    const cancellableStatuses: schema.Order['status'][] = [
      'pending',
      'processing',
    ];
    if (!cancellableStatuses.includes(order.status)) {
      throw new InvalidOperationError(
        `Cannot cancel an order that is already '${order.status}'`,
      );
    }
    return this.cancelOrderInternal(orderId, reason || 'Cancelled by customer');
  }

  async expireOrder(
    orderId: string,
    reason = 'Checkout session expired (unpaid online order)',
  ): Promise<schema.Order> {
    return this.cancelOrderInternal(orderId, reason, undefined, true);
  }

  async updateOrderStatus(id: string, status: string): Promise<schema.Order> {
    const validStatuses: schema.Order['status'][] = [
      'pending',
      'processing',
      'shipped',
      'out_for_delivery',
      'delivered',
      'cancelled',
      'refunded',
    ];
    if (!validStatuses.includes(status as schema.Order['status'])) {
      throw new InvalidOperationError(
        `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
      );
    }

    if (status === 'cancelled') {
      return this.cancelOrderInternal(id, 'Admin cancellation');
    }

    const updated = await this.ordersStore.runTransaction(async (tx) => {
      const existing = await this.ordersStore.findOrderByIdForUpdate(id, tx);
      if (!existing) {
        throw new EntityNotFoundError('Order not found');
      }

      if (existing.status === status) {
        return existing;
      }

      const allowedNext = ORDER_STATE_TRANSITIONS[existing.status] || [];
      if (!allowedNext.includes(status as schema.Order['status'])) {
        throw new InvalidOperationError(
          `Invalid status transition from '${existing.status}' to '${status}'`,
        );
      }

      const order = await this.ordersStore.updateOrderStatus(id, status, tx);
      if (!order) {
        throw new EntityNotFoundError('Order not found');
      }

      if (status === 'shipped') {
        await this.ordersStore.createOutboxEvent(
          {
            type: 'CREATE_CONSIGNMENT',
            payload: { orderId: id },
            status: 'pending',
          },
          tx,
        );
      } else if (status === 'delivered') {
        const user = await this.ordersStore.getUserBasicInfo(order.userId, tx);
        if (user?.phone) {
          await this.ordersStore.createOutboxEvent(
            {
              type: 'SEND_SMS',
              payload: {
                type: 'delivered',
                phone: user.phone,
                orderId: id,
              },
            },
            tx,
          );
        }
      }

      return order;
    });

    return updated;
  }

  /**
   * Internal atomic order cancellation routine.
   * Executes under an ACID PostgreSQL transaction with row-level locks:
   * 1. Locks the order row and verifies eligibility
   * 2. Atomically transitions order status to 'cancelled'
   * 3. Restores product & variant inventory and records inventory transaction audit logs
   * 4. Decrements promo usage quota if a promo code was applied
   * 5. Refunds spent loyalty points if loyalty points were redeemed
   * 6. Marks any pending payment records as 'failed'
   * 7. Enqueues a cancellation outbox notification
   */
  private async cancelOrderInternal(
    orderId: string,
    reason: string,
    existingTx?: any,
    isExpiry = false,
  ): Promise<schema.Order> {
    const handler = async (tx: any) => {
      const existingOrder = await this.ordersStore.findOrderByIdForUpdate(
        orderId,
        tx,
      );
      if (!existingOrder) {
        throw new EntityNotFoundError('Order not found');
      }

      if (existingOrder.status === 'cancelled') {
        throw new InvalidOperationError('Order is already cancelled');
      }

      if (isExpiry) {
        if (existingOrder.status !== 'pending') {
          throw new InvalidOperationError(
            `Cannot expire order that is '${existingOrder.status}' (only pending orders can expire)`,
          );
        }
        if (existingOrder.paymentStatus === 'paid') {
          throw new InvalidOperationError(
            'Cannot expire order that has already been paid',
          );
        }
      }

      const cancellableStatuses: schema.Order['status'][] = [
        'pending',
        'processing',
      ];
      if (!cancellableStatuses.includes(existingOrder.status)) {
        throw new InvalidOperationError(
          `Cannot cancel an order that is '${existingOrder.status}'`,
        );
      }

      const order = await this.ordersStore.transitionOrderStatusForCancellation(
        orderId,
        tx,
      );
      if (!order) {
        throw new InvalidOperationError(
          'Order could not be cancelled (status changed concurrently)',
        );
      }

      const items = await this.ordersStore.getOrderItemsForRestock(orderId, tx);
      for (const item of items) {
        if (item.variantId) {
          await this.ordersStore.restoreVariantStock(
            item.variantId,
            item.quantity,
            tx,
          );
        } else {
          await this.ordersStore.restoreProductStock(
            item.productId,
            item.quantity,
            tx,
          );
        }

        await this.ordersStore.createInventoryTransaction(
          {
            productId: item.productId,
            type: 'in',
            quantity: item.quantity,
            referenceId: order.id,
            notes: `Order cancelled — stock restored (${reason})`,
          },
          tx,
        );
      }

      if (order.promoId) {
        await this.ordersStore.decrementPromoUsage(order.promoId, tx);
      }

      const pointsSpent = await this.ordersStore.getPointsSpentOnOrder(
        orderId,
        tx,
      );
      if (pointsSpent > 0) {
        const alreadyRefunded = await this.ordersStore.hasPointsBeenRefunded(
          orderId,
          tx,
        );
        if (!alreadyRefunded) {
          await this.loyaltyService.refundPoints(
            order.userId,
            pointsSpent,
            orderId,
            tx,
          );
        }
      }

      await this.ordersStore.failPendingPaymentsForOrder(orderId, tx);

      const user = await this.ordersStore.getUserBasicInfo(order.userId, tx);
      if (user?.phone) {
        await this.ordersStore.createOutboxEvent(
          {
            type: 'SEND_SMS',
            payload: {
              type: 'cancelled',
              phone: user.phone,
              orderId: order.id,
              reason,
            },
          },
          tx,
        );
      }

      if (existingOrder.paymentStatus === 'paid') {
        await this.ordersStore.createOutboxEvent(
          {
            type: 'REFUND_REQUIRED',
            payload: {
              orderId: existingOrder.id,
              userId: existingOrder.userId,
              amount: existingOrder.totalAmount,
              reason: `Order cancelled while paid (${reason})`,
            },
            status: 'pending',
          },
          tx,
        );
      }

      return order;
    };

    if (existingTx) {
      return await handler(existingTx);
    }
    return await this.ordersStore.runTransaction(handler);
  }
}
