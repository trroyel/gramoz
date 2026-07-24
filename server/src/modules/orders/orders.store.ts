import { Injectable, Inject } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and, desc, sql } from 'drizzle-orm';
import { DATABASE } from '@database/database.module';
import * as schema from '@database/schema';

@Injectable()
export class OrdersStore {
  constructor(
    @Inject(DATABASE) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async runTransaction<T>(cb: (tx: any) => Promise<T>): Promise<T> {
    return await this.db.transaction(cb);
  }

  // --- Cart ---
  async getCartItemsWithProducts(userId: string, tx?: any) {
    const executor = tx || this.db;
    return await executor
      .select({
        id: schema.cartItems.id,
        productId: schema.cartItems.productId,
        quantity: schema.cartItems.quantity,
        productPrice: schema.products.price,
        productStock: schema.products.stock,
        productName: schema.products.name,
        variantId: schema.cartItems.variantId,
        variantPrice: schema.productVariants.price,
        variantStock: schema.productVariants.stock,
        variantAttributes: schema.productVariants.attributes,
      })
      .from(schema.cartItems)
      .leftJoin(
        schema.products,
        eq(schema.cartItems.productId, schema.products.id),
      )
      .leftJoin(
        schema.productVariants,
        eq(schema.cartItems.variantId, schema.productVariants.id),
      )
      .where(eq(schema.cartItems.userId, userId));
  }

  async deleteCartItemsByUserId(userId: string, tx?: any): Promise<void> {
    const executor = tx || this.db;
    await executor
      .delete(schema.cartItems)
      .where(eq(schema.cartItems.userId, userId));
  }

  // --- Addresses ---
  async findAddress(userId: string, addressLine1: string, city: string, tx?: any): Promise<schema.Address | null> {
    const executor = tx || this.db;
    const [existingAddress] = await executor
      .select()
      .from(schema.addresses)
      .where(
        and(
          eq(schema.addresses.userId, userId),
          eq(schema.addresses.addressLine1, addressLine1),
          eq(schema.addresses.city, city),
        ),
      )
      .limit(1);
    return existingAddress || null;
  }

  async createAddress(data: typeof schema.addresses.$inferInsert, tx?: any): Promise<schema.Address> {
    const executor = tx || this.db;
    const [address] = await executor
      .insert(schema.addresses)
      .values(data)
      .returning();
    return address;
  }

  /** Backfills zoneId on an existing address that was saved before this column existed. */
  async updateAddressZone(addressId: string, zoneId: string, tx?: any): Promise<schema.Address> {
    const executor = tx || this.db;
    const [updated] = await executor
      .update(schema.addresses)
      .set({ zoneId, updatedAt: new Date() })
      .where(eq(schema.addresses.id, addressId))
      .returning();
    return updated;
  }

  // --- Orders & Items ---
  async createOrder(data: typeof schema.orders.$inferInsert, tx?: any): Promise<schema.Order> {
    const executor = tx || this.db;
    const [order] = await executor
      .insert(schema.orders)
      .values(data)
      .returning();
    return order;
  }

  async createOrderItem(data: typeof schema.orderItems.$inferInsert, tx?: any): Promise<schema.OrderItem> {
    const executor = tx || this.db;
    const [orderItem] = await executor
      .insert(schema.orderItems)
      .values(data)
      .returning();
    return orderItem;
  }

  // --- Products & Inventory ---
  async deductProductStock(productId: string, quantity: number, tx?: any): Promise<boolean> {
    const executor = tx || this.db;
    const [updated] = await executor
      .update(schema.products)
      .set({
        stock: sql`${schema.products.stock} - ${quantity}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.products.id, productId),
          sql`${schema.products.stock} >= ${quantity}`,
        ),
      )
      .returning({ stock: schema.products.stock });
      
    return !!updated;
  }

  async deductVariantStock(variantId: string, quantity: number, tx?: any): Promise<boolean> {
    const executor = tx || this.db;
    const [updated] = await executor
      .update(schema.productVariants)
      .set({
        stock: sql`${schema.productVariants.stock} - ${quantity}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.productVariants.id, variantId),
          sql`${schema.productVariants.stock} >= ${quantity}`,
        ),
      )
      .returning({ stock: schema.productVariants.stock });
      
    return !!updated;
  }

  async createInventoryTransaction(data: typeof schema.inventoryTransactions.$inferInsert, tx?: any): Promise<void> {
    const executor = tx || this.db;
    await executor.insert(schema.inventoryTransactions).values(data);
  }

  // --- Promos ---
  async incrementPromoUsage(promoId: string, tx?: any): Promise<boolean> {
    const executor = tx || this.db;
    const [updatedPromo] = await executor
      .update(schema.promos)
      .set({ currentUses: sql`${schema.promos.currentUses} + 1` })
      .where(
        and(
          eq(schema.promos.id, promoId),
          sql`(${schema.promos.maxUses} IS NULL OR ${schema.promos.currentUses} < ${schema.promos.maxUses})`,
        ),
      )
      .returning({ id: schema.promos.id });
      
    return !!updatedPromo;
  }

  // --- Users ---
  async getUserBasicInfo(userId: string, tx?: any): Promise<{ email: string, fullName: string, phone: string | null } | null> {
    const executor = tx || this.db;
    const [user] = await executor
      .select({ email: schema.users.email, fullName: schema.users.fullName, phone: schema.users.phone })
      .from(schema.users)
      .where(eq(schema.users.id, userId));
    return user || null;
  }

  // --- Outbox ---
  async createOutboxEvent(data: typeof schema.outboxEvents.$inferInsert, tx?: any): Promise<void> {
    const executor = tx || this.db;
    await executor.insert(schema.outboxEvents).values(data);
  }

  // --- Complex Queries ---
  async getUserOrdersWithPayments(userId: string, limit: number, offset: number) {
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
    return ordersWithPayments;
  }

  async getOrderDetailsWithPayments(userId: string, orderId: string) {
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
    return order || null;
  }

  async getOrderItemsWithProducts(orderId: string) {
    return await this.db
      .select({
        id: schema.orderItems.id,
        productId: schema.orderItems.productId,
        variantId: schema.orderItems.variantId,
        variantAttributes: schema.orderItems.variantAttributes,
        quantity: schema.orderItems.quantity,
        unitPrice: schema.orderItems.unitPrice,
        productName: schema.products.name,
        productImages: schema.products.images,
        variantImage: schema.productVariants.imageUrl,
      })
      .from(schema.orderItems)
      .leftJoin(
        schema.products,
        eq(schema.orderItems.productId, schema.products.id),
      )
      .leftJoin(
        schema.productVariants,
        eq(schema.orderItems.variantId, schema.productVariants.id),
      )
      .where(eq(schema.orderItems.orderId, orderId));
  }

  async getOrderDetailsAsAdmin(orderId: string) {
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
    return order || null;
  }

  async getLatestPaymentByOrderId(orderId: string) {
    const [payment] = await this.db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.orderId, orderId))
      .orderBy(desc(schema.payments.createdAt))
      .limit(1);
    return payment || null;
  }

  async getAllOrdersWithRelationsAsAdmin(limit: number, offset: number) {
    return await this.db.query.orders.findMany({
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
  }

  async updateOrderStatus(id: string, status: string, tx?: any): Promise<schema.Order | null> {
    const executor = tx || this.db;
    const [order] = await executor
      .update(schema.orders)
      .set({
        status: status as schema.Order['status'],
        updatedAt: new Date(),
      })
      .where(eq(schema.orders.id, id))
      .returning();
    return order || null;
  }
}
