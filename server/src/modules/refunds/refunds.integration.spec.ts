/* eslint-disable @typescript-eslint/no-unsafe-assignment */

/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, sql } from 'drizzle-orm';
import * as schema from '@database/schema';
import { RefundsService } from './refunds.service';
import { RefundsStore } from './refunds.store';
import { PaymentsService } from '../payments/payments.service';
import { PaymentsStore } from '../payments/payments.store';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { LoyaltyStore } from '../loyalty/loyalty.store';
import { SettingsService } from '../settings/settings.service';
import { SettingsStore } from '../settings/settings.store';

describe('TASK-22: Real PostgreSQL Refunds & Inventory Restocking Integration Suite', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle>;
  let refundsStore: RefundsStore;
  let refundsService: RefundsService;
  let paymentsStore: PaymentsStore;
  let paymentsService: PaymentsService;
  let loyaltyStore: LoyaltyStore;
  let loyaltyService: LoyaltyService;
  let settingsStore: SettingsStore;
  let settingsService: SettingsService;

  const testDbUrl =
    process.env.DATABASE_URL ||
    'postgresql://platform_user:platform_pass@localhost:5433/platform_db';

  const createdUserIds: string[] = [];
  const createdAddressIds: string[] = [];
  const createdCategoryIds: string[] = [];
  const createdProductIds: string[] = [];
  const createdOrderIds: string[] = [];

  beforeAll(async () => {
    pool = new Pool({
      connectionString: testDbUrl,
      connectionTimeoutMillis: 5000,
      max: 20,
    });
    db = drizzle(pool, { schema });

    refundsStore = new RefundsStore(db as any);
    paymentsStore = new PaymentsStore(db as any);
    loyaltyStore = new LoyaltyStore(db as any);
    settingsStore = new SettingsStore(db as any);

    settingsService = new SettingsService(settingsStore);
    loyaltyService = new LoyaltyService(loyaltyStore, settingsService);

    const mockConfig = {
      get: (key: string, defaultVal?: unknown) => {
        const values: Record<string, unknown> = {
          SSLCOMMERZ_STORE_ID: 'test-store',
          SSLCOMMERZ_STORE_SECRET: 'test-secret',
          SSLCOMMERZ_IS_SANDBOX: 'true',
        };
        return values[key] ?? defaultVal;
      },
    } as any;

    paymentsService = new PaymentsService(mockConfig, paymentsStore);
    refundsService = new RefundsService(
      refundsStore,
      paymentsService,
      loyaltyService,
    );
  });

  afterAll(async () => {
    try {
      for (const orderId of createdOrderIds) {
        await db
          .delete(schema.inventoryTransactions)
          .where(eq(schema.inventoryTransactions.referenceId, orderId));
        await db
          .delete(schema.refunds)
          .where(eq(schema.refunds.orderId, orderId));
        await db
          .delete(schema.payments)
          .where(eq(schema.payments.orderId, orderId));
        await db
          .delete(schema.orderItems)
          .where(eq(schema.orderItems.orderId, orderId));
        await db
          .delete(schema.loyaltyPoints)
          .where(eq(schema.loyaltyPoints.referenceId, orderId));
        await db.delete(schema.orders).where(eq(schema.orders.id, orderId));
      }

      for (const addrId of createdAddressIds) {
        await db
          .delete(schema.addresses)
          .where(eq(schema.addresses.id, addrId));
      }

      for (const prodId of createdProductIds) {
        await db
          .delete(schema.inventoryTransactions)
          .where(eq(schema.inventoryTransactions.productId, prodId));
        await db
          .delete(schema.productVariants)
          .where(eq(schema.productVariants.productId, prodId));
        await db.delete(schema.products).where(eq(schema.products.id, prodId));
      }

      for (const catId of createdCategoryIds) {
        await db
          .delete(schema.categories)
          .where(eq(schema.categories.id, catId));
      }

      for (const uid of createdUserIds) {
        await db
          .delete(schema.loyaltyPoints)
          .where(eq(schema.loyaltyPoints.userId, uid));
        await db.delete(schema.users).where(eq(schema.users.id, uid));
      }
    } finally {
      await pool.end();
    }
  });

  // Helpers
  async function createTestCustomer(prefix = 'cust') {
    const [user] = await db
      .insert(schema.users)
      .values({
        email: `${prefix}_${Date.now()}_${Math.random().toString(36).substring(7)}@test.com`,
        passwordHash: 'dummyhash',
        fullName: 'Test Customer',
        role: 'customer',
      })
      .returning();
    createdUserIds.push(user.id);
    return user;
  }

  async function createTestProduct(initialStock = 50) {
    const [category] = await db
      .insert(schema.categories)
      .values({
        name: `Cat_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        slug: `cat-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      })
      .returning();
    createdCategoryIds.push(category.id);

    const [product] = await db
      .insert(schema.products)
      .values({
        name: `Product_${Date.now()}`,
        slug: `prod-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        price: '500.00',
        stock: initialStock,
        categoryId: category.id,
      })
      .returning();
    createdProductIds.push(product.id);

    const [variant] = await db
      .insert(schema.productVariants)
      .values({
        productId: product.id,
        sku: `SKU-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        price: '500.00',
        stock: initialStock,
        attributes: { size: 'L' },
      })
      .returning();

    return { product, variant };
  }

  async function createTestOrderWithPayment(
    userId: string,
    productId: string,
    variantId: string | null,
    quantity = 2,
    orderStatus = 'delivered',
    paymentMethod = 'COD',
  ) {
    const [addr] = await db
      .insert(schema.addresses)
      .values({
        userId,
        title: 'Home',
        addressLine1: 'Road 18, Block D',
        city: 'Dhaka',
        isDefault: true,
      })
      .returning();
    createdAddressIds.push(addr.id);

    const totalAmount = (500.0 * quantity).toFixed(2);
    const [order] = await db
      .insert(schema.orders)
      .values({
        userId,
        shippingAddressId: addr.id,
        status: orderStatus as any,
        paymentStatus: 'paid',
        totalAmount,
      })
      .returning();
    createdOrderIds.push(order.id);

    await db.insert(schema.orderItems).values({
      orderId: order.id,
      productId,
      variantId,
      quantity,
      unitPrice: '500.00',
    });

    const [payment] = await db
      .insert(schema.payments)
      .values({
        orderId: order.id,
        amount: totalAmount,
        status: 'completed',
        method: paymentMethod,
        transactionId: `TRN_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        gatewayResponse: { bank_tran_id: `BANK_${Date.now()}` },
      })
      .returning();

    return { order, payment };
  }

  describe('PostgreSQL End-to-End Refund Verification', () => {
    it('creates a refund in real PostgreSQL and enforces unique constraint uq_refunds_order_id', async () => {
      const customer = await createTestCustomer();
      const { product, variant } = await createTestProduct(20);
      const { order, payment } = await createTestOrderWithPayment(
        customer.id,
        product.id,
        variant.id,
        1,
        'delivered',
      );

      // Customer requests refund
      const refund = await refundsService.requestRefund(customer.id, {
        orderId: order.id,
        amount: 500.0,
        reason: 'wrong_item',
        notes: 'Wrong color received',
      });

      expect(refund.id).toBeDefined();
      expect(refund.status).toBe('requested');
      expect(refund.orderId).toBe(order.id);
      expect(refund.paymentId).toBe(payment.id);

      // Verify row in real DB
      const [dbRefund] = await db
        .select()
        .from(schema.refunds)
        .where(eq(schema.refunds.id, refund.id));
      expect(dbRefund).toBeDefined();
      expect(parseFloat(dbRefund.amount)).toBe(500.0);

      // Attempting duplicate request must fail cleanly via unique index uq_refunds_order_id
      await expect(
        refundsService.requestRefund(customer.id, {
          orderId: order.id,
          amount: 500.0,
          reason: 'wrong_item',
        }),
      ).rejects.toThrow('A refund request already exists for this order');
    });

    it('processes refund, restocks variant & product in DB, and creates inventory transactions', async () => {
      const admin = await createTestCustomer('admin');
      const customer = await createTestCustomer('cust');
      const { product, variant } = await createTestProduct(10);
      const { order, payment } = await createTestOrderWithPayment(
        customer.id,
        product.id,
        variant.id,
        2,
        'delivered',
      );

      const refund = await refundsService.requestRefund(customer.id, {
        orderId: order.id,
        amount: 1000.0,
        reason: 'quality_issue',
      });

      // Admin processes the refund
      const processed = await refundsService.processRefund(
        admin.id,
        refund.id,
        {
          status: 'processed',
          adminNotes: 'Inspection passed, restock approved',
        },
      );

      expect(processed.status).toBe('processed');

      // Verify payment and order status in DB
      const [updatedPayment] = await db
        .select()
        .from(schema.payments)
        .where(eq(schema.payments.id, payment.id));
      expect(updatedPayment.status).toBe('refunded');

      const [updatedOrder] = await db
        .select()
        .from(schema.orders)
        .where(eq(schema.orders.id, order.id));
      expect(updatedOrder.status).toBe('refunded');
      expect(updatedOrder.paymentStatus).toBe('refunded');

      // Verify variant stock incremented by 2
      const [updatedVariant] = await db
        .select()
        .from(schema.productVariants)
        .where(eq(schema.productVariants.id, variant.id));
      expect(updatedVariant.stock).toBe(12); // 10 + 2 = 12

      // Verify inventory transaction created
      const [invTx] = await db
        .select()
        .from(schema.inventoryTransactions)
        .where(eq(schema.inventoryTransactions.referenceId, refund.id));
      expect(invTx).toBeDefined();
      expect(invTx.type).toBe('in');
      expect(invTx.quantity).toBe(2);
    });

    it('prevents double restocking when order was cancelled before refunding', async () => {
      const admin = await createTestCustomer('admin');
      const customer = await createTestCustomer('cust');
      const { product, variant } = await createTestProduct(15);

      // Order created in cancelled state (e.g. cancelled while paid)
      const { order } = await createTestOrderWithPayment(
        customer.id,
        product.id,
        variant.id,
        3,
        'cancelled',
      );

      // Record prior inventory restoration from cancellation
      await db.insert(schema.inventoryTransactions).values({
        productId: product.id,
        type: 'in',
        quantity: 3,
        referenceId: order.id,
        notes: 'Order cancelled — stock restored',
      });

      // OutboxProcessor enqueues refund for cancelled order
      const [refund] = await db
        .insert(schema.refunds)
        .values({
          orderId: order.id,
          requestedBy: customer.id,
          amount: '1500.00',
          reason: 'other',
          status: 'requested',
        })
        .returning();

      // Admin processes refund
      await refundsService.processRefund(admin.id, refund.id, {
        status: 'processed',
        gatewayRefundId: 'MANUAL-REF',
      });

      // Stock must NOT have been incremented again (must still be 15, not 18)
      const [updatedVariant] = await db
        .select()
        .from(schema.productVariants)
        .where(eq(schema.productVariants.id, variant.id));
      expect(updatedVariant.stock).toBe(15);
    });

    it('damaged goods refund creates damaged inventory record and DOES NOT add to saleable stock', async () => {
      const admin = await createTestCustomer('admin');
      const customer = await createTestCustomer('cust');
      const { product, variant } = await createTestProduct(25);
      const { order } = await createTestOrderWithPayment(
        customer.id,
        product.id,
        variant.id,
        2,
        'delivered',
      );

      const refund = await refundsService.requestRefund(customer.id, {
        orderId: order.id,
        amount: 1000.0,
        reason: 'damaged_item',
        notes: 'Item arrived shattered in box',
      });

      await refundsService.processRefund(admin.id, refund.id, {
        status: 'processed',
        gatewayRefundId: 'DAMAGE-REFUND',
      });

      // Variant stock must NOT increase (must remain 25)
      const [updatedVariant] = await db
        .select()
        .from(schema.productVariants)
        .where(eq(schema.productVariants.id, variant.id));
      expect(updatedVariant.stock).toBe(25);

      // Inventory transaction must exist with note 'Damaged item return'
      const [invTx] = await db
        .select()
        .from(schema.inventoryTransactions)
        .where(eq(schema.inventoryTransactions.referenceId, refund.id));
      expect(invTx).toBeDefined();
      expect(invTx.notes).toContain('Damaged item return');
    });

    it('restores spent loyalty points upon delivered order refund and prevents duplicate point refund', async () => {
      const admin = await createTestCustomer('admin');
      const customer = await createTestCustomer('cust');
      const { product, variant } = await createTestProduct(5);
      const { order } = await createTestOrderWithPayment(
        customer.id,
        product.id,
        variant.id,
        1,
        'delivered',
      );

      // Record spent loyalty points on order (100 points)
      await db.insert(schema.loyaltyPoints).values({
        userId: customer.id,
        points: -100,
        type: 'spent_checkout',
        referenceId: order.id,
      });

      const refund = await refundsService.requestRefund(customer.id, {
        orderId: order.id,
        amount: 500.0,
        reason: 'changed_mind',
      });

      await refundsService.processRefund(admin.id, refund.id, {
        status: 'processed',
        gatewayRefundId: 'LOYALTY-REFUND-1',
      });

      // Loyalty points should be refunded
      const [refundPointTx] = await db
        .select()
        .from(schema.loyaltyPoints)
        .where(
          sql`${schema.loyaltyPoints.referenceId} = ${order.id} AND ${schema.loyaltyPoints.type} = 'admin_adjustment'`,
        );
      expect(refundPointTx).toBeDefined();
      expect(refundPointTx.points).toBe(100);

      // Total balance for user should now be 0 (spent -100, refunded +100)
      const balance = await loyaltyService.getBalance(customer.id);
      expect(balance).toBe(0);
    });
  });
});
