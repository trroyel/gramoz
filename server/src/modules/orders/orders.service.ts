import {
  Injectable,
  Inject,
} from '@nestjs/common';
import { EntityNotFoundError, InvalidOperationError, InsufficientStockError } from '../../common/errors/domain.errors';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and, desc, sql } from 'drizzle-orm';
import { DATABASE } from '@database/database.module';
import * as schema from '@database/schema';
import { CreateOrderDto } from './dto/create-order.dto';
import { PromosService } from '../promos/promos.service';

@Injectable()
export class OrdersService {
  constructor(
    @Inject(DATABASE) private readonly db: NodePgDatabase<typeof schema>,
    private readonly promosService: PromosService,
  ) {}

  async createOrderFromCart(userId: string, dto: CreateOrderDto): Promise<schema.Order> {
    // 1. Fetch user's cart with product details
    const cartItems = await this.db
      .select({
        id: schema.cartItems.id,
        productId: schema.cartItems.productId,
        quantity: schema.cartItems.quantity,
        productPrice: schema.products.price,
        productStock: schema.products.stock,
        productName: schema.products.name,
      })
      .from(schema.cartItems)
      .leftJoin(
        schema.products,
        eq(schema.cartItems.productId, schema.products.id),
      )
      .where(eq(schema.cartItems.userId, userId));

    if (cartItems.length === 0) {
      throw new InvalidOperationError('Your cart is empty');
    }

    // 2. Preliminary stock check (optimistic, real lock happens inside transaction)
    for (const item of cartItems) {
      if ((item.productStock ?? 0) < item.quantity) {
        throw new InsufficientStockError(
          `Insufficient stock for "${item.productName}". Available: ${item.productStock}`,
        );
      }
    }

    let totalAmount =
      cartItems.reduce((sum, item) => {
        const priceInCents = Math.round(
          parseFloat(item.productPrice ?? '0') * 100,
        );
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
      discountAmount = promoResult.discountAmount;
      totalAmount -= discountAmount;
    }

    const result = await this.db.transaction(async (tx) => {
      // 3. Reuse existing address if it matches, otherwise create a new one
      const [existingAddress] = await tx
        .select()
        .from(schema.addresses)
        .where(
          and(
            eq(schema.addresses.userId, userId),
            eq(schema.addresses.addressLine1, dto.addressLine1),
            eq(schema.addresses.city, dto.city),
          ),
        )
        .limit(1);

      const address =
        existingAddress ??
        (
          await tx
            .insert(schema.addresses)
            .values({
              userId,
              title: 'Shipping Address',
              addressLine1: dto.addressLine1,
              city: dto.city,
              isDefault: false,
            })
            .returning()
        )[0];

      // 4. Create the order
      const [order] = await tx
        .insert(schema.orders)
        .values({
          userId,
          shippingAddressId: address.id,
          totalAmount: totalAmount.toFixed(2),
          status: 'pending',
          promoId: appliedPromoId,
          discountAmount: discountAmount.toString(),
        })
        .returning();

      // 5. Atomic stock deduction — if any product was concurrently bought down,
      //    the WHERE clause (stock >= qty) will match 0 rows and we abort.
      for (const item of cartItems) {
        await tx.insert(schema.orderItems).values({
          orderId: order.id,
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.productPrice ?? '0',
        });

        const [updated] = await tx
          .update(schema.products)
          .set({
            stock: sql`${schema.products.stock} - ${item.quantity}`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.products.id, item.productId!),
              // This WHERE clause is the lock — prevents overselling
              sql`${schema.products.stock} >= ${item.quantity}`,
            ),
          )
          .returning({ stock: schema.products.stock });

        if (!updated) {
          // Stock was insufficient by the time we got the lock — abort
          throw new InsufficientStockError(
            `"${item.productName}" just sold out. Please remove it from your cart.`,
          );
        }

        await tx.insert(schema.inventoryTransactions).values({
          productId: item.productId,
          type: 'out',
          quantity: item.quantity,
          referenceId: order.id,
          notes: `Order placed`,
        });
      }

      // 6. Clear the cart
      await tx
        .delete(schema.cartItems)
        .where(eq(schema.cartItems.userId, userId));

      // 7. Atomically increment promo usage — the conditional WHERE ensures we
      //    never exceed maxUses even under concurrent checkouts (TOCTOU fix).
      //    0 rows returned = another request just consumed the last use → abort.
      if (appliedPromoId) {
        const [updatedPromo] = await tx
          .update(schema.promos)
          .set({ currentUses: sql`${schema.promos.currentUses} + 1` })
          .where(
            and(
              eq(schema.promos.id, appliedPromoId),
              // Only succeed if still under the usage limit (or no limit set)
              sql`(${schema.promos.maxUses} IS NULL OR ${schema.promos.currentUses} < ${schema.promos.maxUses})`,
            ),
          )
          .returning({ id: schema.promos.id });

        if (!updatedPromo) {
          throw new InvalidOperationError(
            'This promo code just reached its usage limit. Please try without a promo code.',
          );
        }
      }

      // Fetch user info inside the transaction so it's available for the
      // email outbox payload without an extra round-trip after commit.
      const [user] = await tx
        .select({ email: schema.users.email, fullName: schema.users.fullName })
        .from(schema.users)
        .where(eq(schema.users.id, userId));

      // 8a. Enqueue order confirmation email — inside the transaction so this
      //     outbox entry is NEVER lost even if the process crashes post-commit.
      if (user) {
        const emailItems = cartItems.map((i) => ({
          productName: i.productName ?? 'Product',
          quantity: i.quantity,
          unitPrice: i.productPrice ?? '0',
        }));
        await tx.insert(schema.outboxEvents).values({
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

      // 8b. Enqueue low-stock check — also inside the transaction for the same reason.
      await tx.insert(schema.outboxEvents).values({
        type: 'SEND_LOW_STOCK_ALERT',
        payload: { productIds: cartItems.map((i) => i.productId!) },
      });

      return { order, items: cartItems, user };
    });

    return result.order;
  }



  async getUserOrders(userId: string, page = 1, limit = 10): Promise<any[]> {
    const offset = (Math.max(1, page) - 1) * Math.min(50, limit);

    const ordersWithPayments = await this.db.query.orders.findMany({
      where: eq(schema.orders.userId, userId),
      orderBy: [desc(schema.orders.createdAt)],
      limit,
      offset,
      with: {
        payments: {
          orderBy: [desc(schema.payments.createdAt)],
          limit: 1,
        },
      },
    });

    return ordersWithPayments.map((order) => ({
      ...order,
      payment: order.payments[0] || null,
      payments: undefined, // remove the array
    }));
  }

  async getOrderDetails(userId: string, orderId: string): Promise<any> {
    const order = await this.db.query.orders.findFirst({
      where: and(
        eq(schema.orders.id, orderId),
        eq(schema.orders.userId, userId),
      ),
      with: {
        payments: {
          orderBy: [desc(schema.payments.createdAt)],
          limit: 1,
        },
      },
    });

    if (!order) {
      throw new EntityNotFoundError('Order not found');
    }

    const items = await this.db
      .select({
        id: schema.orderItems.id,
        quantity: schema.orderItems.quantity,
        unitPrice: schema.orderItems.unitPrice,
        productName: schema.products.name,
      })
      .from(schema.orderItems)
      .leftJoin(
        schema.products,
        eq(schema.orderItems.productId, schema.products.id),
      )
      .where(eq(schema.orderItems.orderId, orderId));

    const { payments, ...orderData } = order;
    return { ...orderData, payment: payments[0] || null, items };
  }

  async getOrderDetailsAsAdmin(orderId: string): Promise<any> {
    const [order] = await this.db
      .select({
        id: schema.orders.id,
        totalAmount: schema.orders.totalAmount,
        status: schema.orders.status,
        createdAt: schema.orders.createdAt,
        consignmentId: schema.orders.consignmentId,
        trackingUrl: schema.orders.trackingUrl,
        customerName: schema.users.fullName,
        customerEmail: schema.users.email,
        customerPhone: schema.users.phone,
        addressLine1: schema.addresses.addressLine1,
        city: schema.addresses.city,
      })
      .from(schema.orders)
      .leftJoin(schema.users, eq(schema.orders.userId, schema.users.id))
      .leftJoin(
        schema.addresses,
        eq(schema.orders.shippingAddressId, schema.addresses.id),
      )
      .where(eq(schema.orders.id, orderId));

    if (!order) {
      throw new EntityNotFoundError('Order not found');
    }

    const items = await this.db
      .select({
        id: schema.orderItems.id,
        quantity: schema.orderItems.quantity,
        unitPrice: schema.orderItems.unitPrice,
        productName: schema.products.name,
      })
      .from(schema.orderItems)
      .leftJoin(
        schema.products,
        eq(schema.orderItems.productId, schema.products.id),
      )
      .where(eq(schema.orderItems.orderId, orderId));

    const payments = await this.db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.orderId, orderId))
      .orderBy(desc(schema.payments.createdAt))
      .limit(1);

    return { ...order, items, payment: payments[0] || null };
  }

  async getAllOrdersAsAdmin(page = 1, limit = 20): Promise<any[]> {
    const offset = (Math.max(1, page) - 1) * Math.min(100, limit);
    const ordersWithRelations = await this.db.query.orders.findMany({
      orderBy: [desc(schema.orders.createdAt)],
      limit,
      offset,
      with: {
        user: {
          columns: {
            fullName: true,
          },
        },
        payments: {
          orderBy: [desc(schema.payments.createdAt)],
          limit: 1,
        },
      },
    });

    return ordersWithRelations.map((order) => {
      const { user, payments, ...orderData } = order;
      return {
        ...orderData,
        customerName: user?.fullName,
        payment: payments[0] || null,
      };
    });
  }

  async updateOrderStatus(id: string, status: string): Promise<schema.Order> {
    // Validate status value against the enum to prevent arbitrary string injection
    const validStatuses = [
      'pending',
      'processing',
      'shipped',
      'delivered',
      'cancelled',
    ];
    if (!validStatuses.includes(status)) {
      throw new InvalidOperationError(
        `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
      );
    }

    // Run everything inside a single transaction so the status update and
    // the outbox event are committed atomically.
    const updated = await this.db.transaction(async (tx) => {
      const [order] = await tx
        .update(schema.orders)
        .set({
          status: status as schema.Order['status'],
          updatedAt: new Date(),
        })
        .where(eq(schema.orders.id, id))
        .returning();

      if (!order) {
        throw new EntityNotFoundError('Order not found');
      }

      // If the order is being marked as shipped, enqueue a courier consignment
      // job in the outbox — same transaction guarantees it won't be lost.
      if (status === 'shipped') {
        await tx.insert(schema.outboxEvents).values({
          type: 'CREATE_CONSIGNMENT',
          payload: { orderId: id },
          status: 'pending',
        });
      }

      return order;
    });

    return updated;
  }
}

