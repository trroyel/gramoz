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
import { OrdersService } from '../orders/orders.service';
import { OrdersStore } from '../orders/orders.store';
import { PromosService } from '../promos/promos.service';
import { CourierService } from '../courier/courier.service';
import { OutboxProcessor } from '../orders/outbox.processor';

describe('TASK-22: Real PostgreSQL Refund Concurrency & Idempotency Suite (CONC-22-A to CONC-22-H)', () => {
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
  let ordersStore: OrdersStore;
  let ordersService: OrdersService;
  let outboxProcessor: OutboxProcessor;

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
      max: 30, // High pool capacity for concurrent workers
    });
    db = drizzle(pool, { schema });

    refundsStore = new RefundsStore(db as any);
    paymentsStore = new PaymentsStore(db as any);
    loyaltyStore = new LoyaltyStore(db as any);
    settingsStore = new SettingsStore(db as any);
    ordersStore = new OrdersStore(db as any);

    settingsService = new SettingsService(settingsStore);
    loyaltyService = new LoyaltyService(loyaltyStore, settingsService);

    const mockCourierService = {
      calculateCharge: jest.fn().mockResolvedValue({ charge: 60 }),
      createConsignment: jest
        .fn()
        .mockResolvedValue({ tracking_code: 'TRK-22' }),
    } as unknown as CourierService;

    const promosService = new PromosService(db as any);

    ordersService = new OrdersService(
      ordersStore,
      promosService,
      loyaltyService,
      settingsService,
      mockCourierService,
    );

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

    outboxProcessor = new OutboxProcessor(
      db as any,
      mockCourierService,
      null as any,
      null as any,
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
        price: '400.00',
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
        price: '400.00',
        stock: initialStock,
        attributes: { size: 'M' },
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
    paymentMethod = 'SSLCommerz',
  ) {
    const [addr] = await db
      .insert(schema.addresses)
      .values({
        userId,
        title: 'Home',
        addressLine1: 'Road 22, Block F',
        city: 'Dhaka',
        isDefault: true,
      })
      .returning();
    createdAddressIds.push(addr.id);

    const totalAmount = (400.0 * quantity).toFixed(2);
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
      unitPrice: '400.00',
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

  // ─── CONCURRENCY SCENARIOS ────────────────────────────────────────────────

  // CONC-22-A: Duplicate Refund Requests
  it('CONC-22-A: Ten simultaneous requests attempt to refund the same eligible payment -> exactly 1 succeeds, 9 fail', async () => {
    const customer = await createTestCustomer('conc_a');
    const { product, variant } = await createTestProduct(30);
    const { order } = await createTestOrderWithPayment(
      customer.id,
      product.id,
      variant.id,
      2,
      'delivered',
    );

    // Launch 10 simultaneous refund requests for the same order
    const promises = Array.from({ length: 10 }).map(() =>
      refundsService.requestRefund(customer.id, {
        orderId: order.id,
        amount: 800.0,
        reason: 'wrong_item',
      }),
    );

    const results = await Promise.allSettled(promises);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // Invariant: Exactly 1 request succeeds
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(9);

    // Verify all 9 rejected with domain duplicate error
    for (const rej of rejected) {
      if (rej.status === 'rejected') {
        expect((rej.reason as Error).message).toContain(
          'A refund request already exists for this order',
        );
      }
    }

    // Verify exactly 1 refund row exists in PostgreSQL
    const dbRefunds = await db
      .select()
      .from(schema.refunds)
      .where(eq(schema.refunds.orderId, order.id));
    expect(dbRefunds.length).toBe(1);
  });

  // CONC-22-B: Refund Amount Ceiling
  it('CONC-22-B: Request exceeding verified order total is rejected atomically', async () => {
    const customer = await createTestCustomer('conc_b');
    const { product, variant } = await createTestProduct(10);
    const { order } = await createTestOrderWithPayment(
      customer.id,
      product.id,
      variant.id,
      1,
      'delivered',
    );

    // Total amount is 400.00; attempt to request 400.01
    await expect(
      refundsService.requestRefund(customer.id, {
        orderId: order.id,
        amount: 400.01,
        reason: 'quality_issue',
      }),
    ).rejects.toThrow('cannot exceed order total');
  });

  // CONC-22-C: Refund Approval Race
  it('CONC-22-C: Two authorized administrators approve the same refund simultaneously -> exactly one succeeds, no double restocking', async () => {
    const admin1 = await createTestCustomer('admin1');
    const admin2 = await createTestCustomer('admin2');
    const customer = await createTestCustomer('cust_c');
    const { product, variant } = await createTestProduct(20);
    const { order } = await createTestOrderWithPayment(
      customer.id,
      product.id,
      variant.id,
      2,
      'delivered',
    );

    const refund = await refundsService.requestRefund(customer.id, {
      orderId: order.id,
      amount: 800.0,
      reason: 'quality_issue',
    });

    // Two admins race to process the refund simultaneously
    const results = await Promise.allSettled([
      refundsService.processRefund(admin1.id, refund.id, {
        status: 'processed',
        gatewayRefundId: 'ADMIN-1-REF',
      }),
      refundsService.processRefund(admin2.id, refund.id, {
        status: 'processed',
        gatewayRefundId: 'ADMIN-2-REF',
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // Invariant: Exactly 1 admin succeeds, other is rejected
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    if (rejected[0].status === 'rejected') {
      expect((rejected[0].reason as Error).message).toContain(
        'Refund request has already been processed',
      );
    }

    // Invariant: Stock must be incremented by 2 (initial 20 + 2 = 22, NOT 24)
    const [updatedVariant] = await db
      .select()
      .from(schema.productVariants)
      .where(eq(schema.productVariants.id, variant.id));
    expect(updatedVariant.stock).toBe(22);
  });

  // CONC-22-D: Duplicate Provider Callback Replay
  it('CONC-22-D: Repeated processing requests cannot duplicate completed refund or restock again', async () => {
    const admin = await createTestCustomer('admin_d');
    const customer = await createTestCustomer('cust_d');
    const { product, variant } = await createTestProduct(15);
    const { order } = await createTestOrderWithPayment(
      customer.id,
      product.id,
      variant.id,
      1,
      'delivered',
    );

    const refund = await refundsService.requestRefund(customer.id, {
      orderId: order.id,
      amount: 400.0,
      reason: 'other',
    });

    // First process succeeds
    await refundsService.processRefund(admin.id, refund.id, {
      status: 'processed',
      gatewayRefundId: 'CALL-1',
    });

    // Subsequent 5 replay attempts must all fail cleanly
    const replays = await Promise.allSettled(
      Array.from({ length: 5 }).map(() =>
        refundsService.processRefund(admin.id, refund.id, {
          status: 'processed',
          gatewayRefundId: 'CALL-REPLAY',
        }),
      ),
    );

    for (const r of replays) {
      expect(r.status).toBe('rejected');
    }

    // Stock must be 16 (15 + 1), not 21
    const [updatedVariant] = await db
      .select()
      .from(schema.productVariants)
      .where(eq(schema.productVariants.id, variant.id));
    expect(updatedVariant.stock).toBe(16);
  });

  // CONC-22-F: Cancellation Versus Refund
  // CONC-22-F: Cancellation Versus Refund
  it('CONC-22-F: Order cancellation and refund processing execute concurrently -> no double restocking or contradictory states', async () => {
    const admin = await createTestCustomer('admin_f');
    const customer = await createTestCustomer('cust_f');
    const { product, variant } = await createTestProduct(50);
    const { order } = await createTestOrderWithPayment(
      customer.id,
      product.id,
      variant.id,
      4,
      'processing',
    );

    // Pre-register refund request (as happens via REFUND_REQUIRED)
    const [refund] = await db
      .insert(schema.refunds)
      .values({
        orderId: order.id,
        requestedBy: customer.id,
        amount: '1600.00',
        reason: 'changed_mind',
        status: 'requested',
      })
      .returning();

    // Run cancelOrder and processRefund concurrently
    const results = await Promise.allSettled([
      ordersService.cancelOrder(customer.id, order.id, 'Customer cancellation'),
      refundsService.processRefund(admin.id, refund.id, {
        status: 'processed',
        gatewayRefundId: 'CONC-F-REF',
      }),
    ]);

    // Both operations must settle safely without database deadlocks
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);

    // Final order status must be cancelled or refunded
    const [finalOrder] = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, order.id));
    expect(['cancelled', 'refunded']).toContain(finalOrder.status);

    // Inventory must be restocked by exactly 4 (50 + 4 = 54, NOT 58)
    const [finalVariant] = await db
      .select()
      .from(schema.productVariants)
      .where(eq(schema.productVariants.id, variant.id));
    expect(finalVariant.stock).toBe(54);
  });

  // CONC-22-G: Outbox Replay Idempotency
  it('CONC-22-G: The same REFUND_REQUIRED event is processed repeatedly -> creates exactly 1 actionable refund record', async () => {
    const customer = await createTestCustomer('cust_g');
    const { product, variant } = await createTestProduct(10);
    const { order, payment } = await createTestOrderWithPayment(
      customer.id,
      product.id,
      variant.id,
      1,
      'cancelled',
    );

    // Insert outbox event in PostgreSQL
    const [eventRow] = await db
      .insert(schema.outboxEvents)
      .values({
        type: 'REFUND_REQUIRED',
        payload: {
          orderId: order.id,
          userId: customer.id,
          paymentId: payment.id,
          amount: '400.00',
          reason: 'Order cancelled while paid',
        },
        status: 'processing',
        attempts: 1,
      })
      .returning();

    // Each replay models a genuine redelivery: the event is re-claimed (processing, same
    // attempts) before the handler runs, as lease-ownership fencing requires.
    const reclaim = async () => {
      await db
        .update(schema.outboxEvents)
        .set({ status: 'processing', attempts: 1 })
        .where(eq(schema.outboxEvents.id, eventRow.id));
    };

    // First replay of event
    const success1 = await outboxProcessor.processEvent(eventRow);
    expect(success1).toBe(true);

    // Second replay of event
    await reclaim();
    const success2 = await outboxProcessor.processEvent(eventRow);
    expect(success2).toBe(true);

    // Third replay of event
    await reclaim();
    const success3 = await outboxProcessor.processEvent(eventRow);
    expect(success3).toBe(true);

    // Exactly 1 refund row must exist for this order in schema.refunds
    const refunds = await db
      .select()
      .from(schema.refunds)
      .where(eq(schema.refunds.orderId, order.id));
    expect(refunds.length).toBe(1);
    expect(refunds[0].status).toBe('requested');
  });

  // CONC-22-H: Provider Success Before Database Update Simulation
  it('CONC-22-H: Provider success before DB update remains reconcilable with authoritative gateway ID', async () => {
    const customer = await createTestCustomer('cust_h');
    const admin = await createTestCustomer('admin_h');
    const { product, variant } = await createTestProduct(10);
    const { order, payment } = await createTestOrderWithPayment(
      customer.id,
      product.id,
      variant.id,
      1,
      'delivered',
    );

    const refund = await refundsService.requestRefund(customer.id, {
      orderId: order.id,
      amount: 400.0,
      reason: 'other',
    });

    // Provider succeeded and returned reference ID:
    const authoritativeGatewayId = 'SSL-PROV-RECONCILE-999';

    // Simulate DB failure or interruption by storing gatewayRefundId in approved state
    await refundsStore.updateRefund(refund.id, {
      status: 'approved',
      gatewayRefundId: authoritativeGatewayId,
      adminNotes: 'Gateway confirmed; awaiting final local reconciliation',
    });

    // Reconciliation process executes
    const [reconciled] = await db
      .select()
      .from(schema.refunds)
      .where(eq(schema.refunds.id, refund.id));
    expect(reconciled.gatewayRefundId).toBe(authoritativeGatewayId);
    expect(reconciled.status).toBe('approved');

    // Admin finalizes the verified reconciliation
    const finalRefund = await refundsService.processRefund(
      admin.id,
      refund.id,
      {
        status: 'processed',
        gatewayRefundId: authoritativeGatewayId,
        adminNotes: 'Reconciliation verified with provider ledger',
      },
    );

    expect(finalRefund.status).toBe('processed');
    expect(finalRefund.gatewayRefundId).toBe(authoritativeGatewayId);
  });

  // ─── TASK-22F VERIFICATION SCENARIOS ─────────────────────────────────────

  // CONC-22-I: Concurrent Admin Gateway Initiation Race (Phase 2 & Phase 5)
  it('CONC-22-I: Two simultaneous admins process the same online refund without gateway ID -> atomic claim permits EXACTLY ONE external provider initiation', async () => {
    const adminA = await createTestCustomer('admin_ia');
    const adminB = await createTestCustomer('admin_ib');
    const customer = await createTestCustomer('cust_i');
    const { product, variant } = await createTestProduct(20);
    const { order, payment } = await createTestOrderWithPayment(
      customer.id,
      product.id,
      variant.id,
      1,
      'delivered',
      'SSLCommerz',
    );

    const refund = await refundsService.requestRefund(customer.id, {
      orderId: order.id,
      amount: 400.0,
      reason: 'wrong_item',
    });

    // Spy on external paymentsService.initiateRefund with simulated network latency
    const initiateSpy = jest
      .spyOn(paymentsService, 'initiateRefund')
      .mockImplementation(async (params) => {
        await new Promise((resolve) => setTimeout(resolve, 80)); // 80ms network latency
        return {
          success: true,
          status: 'initiated',
          refundRefId: `SSL-LIVE-${params.refundId}`,
          bankTranId: 'BANK-LIVE-999',
        };
      });

    try {
      // Both admins click 'Process' at the exact same millisecond WITHOUT providing gatewayRefundId
      const results = await Promise.allSettled([
        refundsService.processRefund(adminA.id, refund.id, {
          status: 'processed',
        }),
        refundsService.processRefund(adminB.id, refund.id, {
          status: 'processed',
        }),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      // CRITICAL INVARIANT: Exactly 1 admin succeeds, other is rejected before network I/O
      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);

      // Verify the rejected admin failed on atomic claim / in-flight processing check
      const rejReason = rejected[0].reason as Error;
      expect(rejReason.message).toMatch(
        /Refund is currently being processed|Refund request has already been processed/,
      );

      // CORE FINANCIAL INVARIANT: Gateway was invoked EXACTLY ONCE! Zero duplicate external refunds!
      expect(initiateSpy).toHaveBeenCalledTimes(1);

      // Verify database state after initiation (INVARIANT: REMAINS IN PROCESSING!)
      const [finalRefund] = await db
        .select()
        .from(schema.refunds)
        .where(eq(schema.refunds.id, refund.id));
      expect(finalRefund.status).toBe('processing');
      expect(finalRefund.gatewayRefundId).toBe(`SSL-LIVE-${refund.id}`);

      // Verify stock was NOT restocked on initiation (remains 20, NOT 21)
      const [interimVariant] = await db
        .select()
        .from(schema.productVariants)
        .where(eq(schema.productVariants.id, variant.id));
      expect(interimVariant.stock).toBe(20);

      // Verify order and payment remain unchanged on initiation
      const [interimOrder] = await db
        .select()
        .from(schema.orders)
        .where(eq(schema.orders.id, order.id));
      expect(interimOrder.status).toBe('delivered');
      expect(interimOrder.paymentStatus).toBe('paid');

      // NOW: Authoritative reconciliation confirms settlement with gateway
      const inquirySpy = jest
        .spyOn(paymentsService, 'queryRefundStatus')
        .mockResolvedValue({
          success: true,
          status: 'refunded',
          refundRefId: finalRefund.gatewayRefundId,
          bankTranId: 'BANK-LIVE-999',
          refundedOn: new Date().toISOString(),
        });

      await refundsService.reconcileRefund(adminA.id, refund.id);
      inquirySpy.mockRestore();

      // After reconciliation, settlement is finalized
      const [reconciledRefund] = await db
        .select()
        .from(schema.refunds)
        .where(eq(schema.refunds.id, refund.id));
      expect(reconciledRefund.status).toBe('processed');

      // Inventory restocked exactly once after authoritative settlement (20 + 1 = 21)
      const [finalVariant] = await db
        .select()
        .from(schema.productVariants)
        .where(eq(schema.productVariants.id, variant.id));
      expect(finalVariant.stock).toBe(21);

      const [finalOrder] = await db
        .select()
        .from(schema.orders)
        .where(eq(schema.orders.id, order.id));
      expect(finalOrder.status).toBe('refunded');
      expect(finalOrder.paymentStatus).toBe('refunded');
    } finally {
      initiateSpy.mockRestore();
    }
  });

  // CONC-22-J: Partial Unique Index — Rejected Refund Re-submission (Phase 8)
  it('CONC-22-J: Rejected refund allows legitimate re-submission, while active refund rejects duplicate', async () => {
    const admin = await createTestCustomer('admin_j');
    const customer = await createTestCustomer('cust_j');
    const { product, variant } = await createTestProduct(10);
    const { order } = await createTestOrderWithPayment(
      customer.id,
      product.id,
      variant.id,
      1,
      'delivered',
      'COD',
    );

    // 1. Initial refund request
    const firstRefund = await refundsService.requestRefund(customer.id, {
      orderId: order.id,
      amount: 400.0,
      reason: 'quality_issue',
      notes: 'Initial request with blurry photo',
    });

    // Attempting a second active request fails due to partial unique index
    await expect(
      refundsService.requestRefund(customer.id, {
        orderId: order.id,
        amount: 400.0,
        reason: 'quality_issue',
      }),
    ).rejects.toThrow('A refund request already exists for this order');

    // 2. Admin rejects the initial request
    await refundsService.processRefund(admin.id, firstRefund.id, {
      status: 'rejected',
      adminNotes: 'Rejected: Please provide clear photographic evidence',
    });

    // 3. Customer submits a corrected refund request for the same order -> SUCCEEDS!
    const resubmittedRefund = await refundsService.requestRefund(customer.id, {
      orderId: order.id,
      amount: 400.0,
      reason: 'quality_issue',
      notes: 'Resubmitted with clear product batch photos',
    });

    expect(resubmittedRefund.id).not.toBe(firstRefund.id);
    expect(resubmittedRefund.status).toBe('requested');

    // 4. While resubmitted request is active, concurrent attempts are blocked
    await expect(
      refundsService.requestRefund(customer.id, {
        orderId: order.id,
        amount: 400.0,
        reason: 'other',
      }),
    ).rejects.toThrow('A refund request already exists for this order');
  });

  // CONC-22-K: Missing Variant Identity Restocking Quarantine (Phase 6)
  it('CONC-22-K: Missing variant identity quarantines stock and prevents phantom parent product inflation', async () => {
    const admin = await createTestCustomer('admin_k');
    const customer = await createTestCustomer('cust_k');
    const { product, variant } = await createTestProduct(10);
    const { order } = await createTestOrderWithPayment(
      customer.id,
      product.id,
      variant.id,
      2,
      'delivered',
      'COD',
    );

    const initialProductStock = product.stock; // Parent product stock

    // Customer requests refund
    const refund = await refundsService.requestRefund(customer.id, {
      orderId: order.id,
      amount: 800.0,
      reason: 'wrong_item',
    });

    // Simulate catalog update where variant was deleted/recreated with new ID (findVariantById returns null)
    const findVariantSpy = jest
      .spyOn(refundsStore, 'findVariantById')
      .mockResolvedValue(null);

    try {
      // Admin processes refund
      const processed = await refundsService.processRefund(
        admin.id,
        refund.id,
        {
          status: 'processed',
          adminNotes: 'Inspection verified by warehouse manager',
          gatewayRefundId: 'COD-CASH-SETTLED-001',
        },
      );

      expect(processed.status).toBe('processed');

      // INVARIANT 1: Parent product saleable stock was NOT incremented (no phantom stock substitution)
      const [freshProduct] = await db
        .select()
        .from(schema.products)
        .where(eq(schema.products.id, product.id));
      expect(freshProduct.stock).toBe(initialProductStock);

      // INVARIANT 2: An auditable quarantine inventory transaction was logged for manual warehouse reconciliation
      const invTx = await db
        .select()
        .from(schema.inventoryTransactions)
        .where(eq(schema.inventoryTransactions.referenceId, refund.id));
      expect(invTx.length).toBe(1);
      expect(invTx[0].notes).toContain(
        'quarantined for warehouse reconciliation',
      );
      expect(invTx[0].quantity).toBe(2);
    } finally {
      findVariantSpy.mockRestore();
    }
  });

  // REF-G09: Concurrent Authoritative Reconciliation Idempotency
  it('REF-G09: Two administrators concurrently reconcile the same confirmed refund -> exactly 1 financial transition, no duplicate restocking or loyalty adjustment', async () => {
    const admin1 = await createTestCustomer('admin_g09_1');
    const admin2 = await createTestCustomer('admin_g09_2');
    const customer = await createTestCustomer('cust_g09');
    const { product, variant } = await createTestProduct(30);
    const { order, payment } = await createTestOrderWithPayment(
      customer.id,
      product.id,
      variant.id,
      2,
      'delivered',
      'SSLCommerz',
    );

    // Seed loyalty points spent on order
    await db.insert(schema.loyaltyPoints).values({
      userId: customer.id,
      points: -40,
      type: 'spent_checkout',
      referenceId: order.id,
    });

    // Create refund directly in 'processing' with gatewayRefundId
    const [refund] = await db
      .insert(schema.refunds)
      .values({
        orderId: order.id,
        paymentId: payment.id,
        requestedBy: customer.id,
        amount: '800.00',
        reason: 'wrong_item',
        status: 'processing',
        gatewayRefundId: `SSL-CONFIRMED-${order.id}`,
      })
      .returning();

    const querySpy = jest
      .spyOn(paymentsService, 'queryRefundStatus')
      .mockImplementation(async (refId) => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return {
          success: true,
          status: 'refunded',
          refundRefId: refId,
          bankTranId: 'BANK-TRAN-G09',
          refundedOn: new Date().toISOString(),
        };
      });

    try {
      const results = await Promise.allSettled([
        refundsService.reconcileRefund(admin1.id, refund.id),
        refundsService.reconcileRefund(admin2.id, refund.id),
      ]);

      for (const res of results) {
        expect(res.status).toBe('fulfilled');
        if (res.status === 'fulfilled') {
          expect(res.value.status).toBe('processed');
        }
      }

      // INVARIANT 1: Final refund status is 'processed'
      const [finalRefund] = await db
        .select()
        .from(schema.refunds)
        .where(eq(schema.refunds.id, refund.id));
      expect(finalRefund.status).toBe('processed');

      // INVARIANT 2: Stock incremented EXACTLY ONCE (30 + 2 = 32, NEVER 34)
      const [finalVariant] = await db
        .select()
        .from(schema.productVariants)
        .where(eq(schema.productVariants.id, variant.id));
      expect(finalVariant.stock).toBe(32);

      // INVARIANT 3: Loyalty points refunded EXACTLY ONCE
      const pointAdjustments = await db
        .select()
        .from(schema.loyaltyPoints)
        .where(
          sql`${schema.loyaltyPoints.referenceId} = ${order.id} AND ${schema.loyaltyPoints.type} = 'admin_adjustment'`,
        );
      expect(pointAdjustments.length).toBe(1);
      expect(pointAdjustments[0].points).toBe(40);
    } finally {
      querySpy.mockRestore();
    }
  });

  // REF-G10: Gateway Accepts Initiation but Application Crashes Before Persisting Response
  it('REF-G10: Application interruption after atomic claim preserves processing state and prevents blind duplicate initiation', async () => {
    const admin = await createTestCustomer('admin_g10');
    const customer = await createTestCustomer('cust_g10');
    const { product, variant } = await createTestProduct(10);
    const { order, payment } = await createTestOrderWithPayment(
      customer.id,
      product.id,
      variant.id,
      1,
      'delivered',
      'SSLCommerz',
    );

    // Simulate interrupted operation: Atomic claim succeeded ('processing') but node died before saving gatewayRefundId
    const [interruptedRefund] = await db
      .insert(schema.refunds)
      .values({
        orderId: order.id,
        paymentId: payment.id,
        requestedBy: customer.id,
        amount: '400.00',
        reason: 'wrong_item',
        status: 'processing',
        adminNotes: 'In-flight gateway claim [Interrupted]',
        gatewayRefundId: null,
      })
      .returning();

    // Another admin or worker attempts to process the same refund -> must be blocked
    await expect(
      refundsService.processRefund(admin.id, interruptedRefund.id, {
        status: 'processed',
      }),
    ).rejects.toThrow(
      'Refund is currently being processed with payment provider',
    );

    // Attempting to reconcile without gateway reference safely requires manual reconciliation
    await expect(
      refundsService.reconcileRefund(admin.id, interruptedRefund.id),
    ).rejects.toThrow(
      'Refund has no gateway reference ID. Manual reconciliation required.',
    );

    // Operation remains discoverable in database in 'processing' state
    const [persisted] = await db
      .select()
      .from(schema.refunds)
      .where(eq(schema.refunds.id, interruptedRefund.id));
    expect(persisted.status).toBe('processing');
    expect(persisted.adminNotes).toContain('In-flight gateway claim');
  });
});
