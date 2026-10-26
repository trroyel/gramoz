import { Test, TestingModule } from '@nestjs/testing';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { DATABASE } from '@database/database.module';
import * as schema from '@database/schema';
import { PromosService } from './promos.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { LoyaltyStore } from '../loyalty/loyalty.store';
import { SettingsService } from '../settings/settings.service';
import { SettingsStore } from '../settings/settings.store';
import { OrdersService } from '../orders/orders.service';
import { OrdersStore } from '../orders/orders.store';
import { CourierService } from '../courier/courier.service';
import { InvoicesService } from '../orders/invoices.service';

describe('Promos & Loyalty Real PostgreSQL Integration', () => {
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let promosService: PromosService;
  let loyaltyService: LoyaltyService;
  let loyaltyStore: LoyaltyStore;
  let settingsService: SettingsService;
  let ordersService: OrdersService;
  let ordersStore: OrdersStore;

  const testDbUrl =
    process.env.DATABASE_URL ||
    'postgresql://platform_user:platform_pass@localhost:5433/platform_db';

  let testUserId: string;
  let testAddressId: string;
  let testProductId: string;

  beforeAll(async () => {
    pool = new Pool({
      connectionString: testDbUrl,
      max: 5,
    });
    db = drizzle(pool, { schema });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PromosService,
        LoyaltyService,
        LoyaltyStore,
        SettingsService,
        SettingsStore,
        OrdersService,
        OrdersStore,
        {
          provide: CourierService,
          useValue: {
            calculateCharge: jest.fn().mockResolvedValue({ charge: 60 }),
          },
        },
        {
          provide: InvoicesService,
          useValue: {
            generateInvoice: jest.fn().mockResolvedValue(Buffer.from('PDF')),
          },
        },
        {
          provide: DATABASE,
          useValue: db,
        },
      ],
    }).compile();

    promosService = module.get<PromosService>(PromosService);
    loyaltyService = module.get<LoyaltyService>(LoyaltyService);
    loyaltyStore = module.get<LoyaltyStore>(LoyaltyStore);
    settingsService = module.get<SettingsService>(SettingsService);
    ordersService = module.get<OrdersService>(OrdersService);
    ordersStore = module.get<OrdersStore>(OrdersStore);

    // Setup base test fixtures in PostgreSQL
    const client = await pool.connect();
    try {
      // 1. Test User
      const userRes = await client.query(`
        INSERT INTO users (email, password_hash, full_name, role, status)
        VALUES ('promoloyalty_test@example.com', 'hash123', 'Promo Loyalty Tester', 'customer', 'active')
        ON CONFLICT (email) DO UPDATE SET full_name = 'Promo Loyalty Tester'
        RETURNING id;
      `);
      testUserId = userRes.rows[0].id;

      // 2. Test Address
      const addrRes = await client.query(`
        INSERT INTO addresses (user_id, title, address_line_1, city)
        VALUES ('${testUserId}', 'Home', '123 Test St', 'Dhaka')
        RETURNING id;
      `);
      testAddressId = addrRes.rows[0].id;

      // 3. Test Product
      const prodRes = await client.query(`
        INSERT INTO products (name, slug, price, stock, status)
        VALUES ('Integration Test Tee', 'integration-test-tee-${Date.now()}', 500.00, 50, 'active')
        RETURNING id;
      `);
      testProductId = prodRes.rows[0].id;
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    const client = await pool.connect();
    try {
      if (testUserId) {
        await client.query(
          `DELETE FROM loyalty_points WHERE user_id = '${testUserId}';`,
        );
      }
      if (testProductId) {
        await client.query(
          `DELETE FROM inventory_transactions WHERE product_id = '${testProductId}';`,
        );
        await client.query(
          `DELETE FROM order_items WHERE product_id = '${testProductId}';`,
        );
      }
      if (testUserId) {
        await client.query(
          `DELETE FROM orders WHERE user_id = '${testUserId}';`,
        );
        await client.query(
          `DELETE FROM addresses WHERE user_id = '${testUserId}';`,
        );
        await client.query(`DELETE FROM users WHERE id = '${testUserId}';`);
      }
      if (testProductId) {
        await client.query(
          `DELETE FROM products WHERE id = '${testProductId}';`,
        );
      }
      await client.query(`DELETE FROM promos WHERE code LIKE 'INTTEST_%';`);
    } finally {
      client.release();
      await pool.end();
    }
  });

  describe('1. Full Promo Lifecycle in PostgreSQL', () => {
    let createdPromoId: string;
    const testCode = `INTTEST_${Date.now()}`;

    it('creates promo and persists to PostgreSQL', async () => {
      const promo = await promosService.create({
        code: testCode,
        discountType: 'percentage',
        discountValue: 20,
        minOrderValue: 200,
        maxUses: 10,
        isActive: true,
      });

      expect(promo.id).toBeDefined();
      expect(promo.code).toBe(testCode);
      expect(Number(promo.discountValue)).toBe(20);
      createdPromoId = promo.id;

      // Verify row exists directly in database
      const [dbRow] = await db
        .select()
        .from(schema.promos)
        .where(eq(schema.promos.id, createdPromoId));
      expect(dbRow).toBeDefined();
      expect(dbRow.code).toBe(testCode);
    });

    it('validates active promo and computes correct discount amount', async () => {
      const validation = await promosService.validate({
        code: testCode,
        subtotal: 500,
      });

      expect(validation.promoId).toBe(createdPromoId);
      expect(validation.discountAmount).toBe(100); // 20% of 500 = 100
    });

    it('findPublicActive returns the promo while active and not exhausted', async () => {
      const publicPromos = await promosService.findPublicActive();
      const found = publicPromos.find((p) => p.id === createdPromoId);
      expect(found).toBeDefined();
    });

    it('toggles isActive and excludes from public active promos', async () => {
      const toggled = await promosService.toggleActive(createdPromoId);
      expect(toggled.isActive).toBe(false);

      const publicPromos = await promosService.findPublicActive();
      const found = publicPromos.find((p) => p.id === createdPromoId);
      expect(found).toBeUndefined();

      // Re-enable for subsequent tests
      await promosService.toggleActive(createdPromoId);
    });

    it('deletes promo from database', async () => {
      const deleted = await promosService.delete(createdPromoId);
      expect(deleted.id).toBe(createdPromoId);

      const [dbRow] = await db
        .select()
        .from(schema.promos)
        .where(eq(schema.promos.id, createdPromoId));
      expect(dbRow).toBeUndefined();
    });
  });

  describe('2. Full Loyalty Points Lifecycle & Ledger Invariant', () => {
    it('awards points and calculates correct available balance', async () => {
      // Clean any existing points for testUser
      await db
        .delete(schema.loyaltyPoints)
        .where(eq(schema.loyaltyPoints.userId, testUserId));

      // Award 50 text review points
      await loyaltyService.awardPoints(
        testUserId,
        50,
        'earned_review_text',
        undefined,
      );

      // Award 100 media review points
      await loyaltyService.awardPoints(
        testUserId,
        100,
        'earned_review_media',
        undefined,
      );

      const balance = await loyaltyService.getBalance(testUserId);
      expect(balance).toBe(150);
    });

    it('spends points atomically with row lock and updates balance', async () => {
      await loyaltyService.spendPoints(testUserId, 80);

      const balanceAfter = await loyaltyService.getBalance(testUserId);
      expect(balanceAfter).toBe(70); // 150 - 80 = 70
    });

    it('rejects spending more points than available balance', async () => {
      await expect(loyaltyService.spendPoints(testUserId, 100)).rejects.toThrow(
        'Insufficient points balance. Available: 70',
      );

      const balance = await loyaltyService.getBalance(testUserId);
      expect(balance).toBe(70);
    });

    it('refunds points with duplicate prevention', async () => {
      const fakeOrderId = 'c1000000-0000-0000-0000-000000000099';

      // First refund: restores 50 points
      await loyaltyService.refundPoints(testUserId, 50, fakeOrderId);
      const balance1 = await loyaltyService.getBalance(testUserId);
      expect(balance1).toBe(120); // 70 + 50 = 120

      // Second duplicate refund for the same orderId: skipped idempotently
      await loyaltyService.refundPoints(testUserId, 50, fakeOrderId);
      const balance2 = await loyaltyService.getBalance(testUserId);
      expect(balance2).toBe(120); // Still 120, not 170!
    });

    it('expiration invariant: balance never becomes negative when expired points were already spent', async () => {
      // Clear points for clean test
      await db
        .delete(schema.loyaltyPoints)
        .where(eq(schema.loyaltyPoints.userId, testUserId));

      // User earned 100 points that expired yesterday
      const yesterday = new Date(Date.now() - 86400000);
      await db.insert(schema.loyaltyPoints).values({
        userId: testUserId,
        points: 100,
        type: 'earned_review_media',
        validUntil: yesterday,
      });

      // User spent 100 points when they were active (validUntil: null)
      await db.insert(schema.loyaltyPoints).values({
        userId: testUserId,
        points: -100,
        type: 'spent_checkout',
        validUntil: null,
      });

      // Available balance must be 0, NEVER negative!
      const balance = await loyaltyService.getBalance(testUserId);
      expect(balance).toBe(0);

      // User now earns 50 active points (valid for 365 days)
      await loyaltyService.awardPoints(testUserId, 50, 'earned_review_text');

      // Balance must reflect full 50 points, not penalized by past expired spending!
      const freshBalance = await loyaltyService.getBalance(testUserId);
      expect(freshBalance).toBe(50);
    });
  });

  describe('3. Checkout & Cancellation with Promo and Loyalty Integration', () => {
    let orderPromoCode: string;
    let orderPromoId: string;
    let placedOrderId: string;

    beforeAll(async () => {
      orderPromoCode = `INTTEST_CHECKOUT_${Date.now()}`;
      const promo = await promosService.create({
        code: orderPromoCode,
        discountType: 'fixed',
        discountValue: 100,
        minOrderValue: 200,
        maxUses: 2,
        isActive: true,
      });
      orderPromoId = promo.id;

      // Add item to cart
      await db
        .delete(schema.cartItems)
        .where(eq(schema.cartItems.userId, testUserId));
      await db.insert(schema.cartItems).values({
        userId: testUserId,
        productId: testProductId,
        quantity: 1, // 500 BDT
      });
    });

    it('creates order with promo code and loyalty points, deducting both correctly', async () => {
      // Current loyalty balance is 50 points. Ratio = 100 pts / BDT -> 50 pts = 0.50 BDT
      const order = await ordersService.createOrderFromCart(testUserId, {
        addressLine1: '123 Test St',
        city: 'Dhaka',
        phone: '01700000000',
        deliveryMethod: 'home',
        promoCode: orderPromoCode,
        usePoints: true,
      });

      placedOrderId = order.id;

      // Subtotal = 500 BDT
      // Promo discount = 100 BDT
      // Remaining subtotal = 400 BDT
      // Loyalty: 50 pts = 0.50 BDT discount
      // Remaining subtotal = 399.50 BDT
      // Delivery charge = 60 BDT
      // Total = 459.50 BDT
      expect(order.promoId).toBe(orderPromoId);
      expect(parseFloat(order.discountAmount)).toBe(100.5); // 100 promo + 0.50 loyalty
      expect(parseFloat(order.totalAmount)).toBe(399.5); // 500 - 100 - 0.50 = 399.50

      // Verify promo currentUses was incremented in PostgreSQL
      const [promoRow] = await db
        .select()
        .from(schema.promos)
        .where(eq(schema.promos.id, orderPromoId));
      expect(promoRow.currentUses).toBe(1);

      // Verify points were deducted in PostgreSQL
      const balance = await loyaltyService.getBalance(testUserId);
      expect(balance).toBe(0); // 50 - 50 = 0
    });

    it('cancelling order restores both promo quota and loyalty points', async () => {
      await ordersService.cancelOrder(
        testUserId,
        placedOrderId,
        'Changed mind on integration test',
      );

      // Verify promo usage decremented back to 0
      const [promoRow] = await db
        .select()
        .from(schema.promos)
        .where(eq(schema.promos.id, orderPromoId));
      expect(promoRow.currentUses).toBe(0);

      // Verify points refunded back to 50
      const restoredBalance = await loyaltyService.getBalance(testUserId);
      expect(restoredBalance).toBe(50);
    });

    it('repeated cancellation fails and does not double-restore promo or points', async () => {
      await expect(
        ordersService.cancelOrder(
          testUserId,
          placedOrderId,
          'Duplicate cancel attempt',
        ),
      ).rejects.toThrow('Order is already cancelled');

      // Verify promo usage remains 0 (not negative!)
      const [promoRow] = await db
        .select()
        .from(schema.promos)
        .where(eq(schema.promos.id, orderPromoId));
      expect(promoRow.currentUses).toBe(0);

      // Verify points remain 50 (not 100!)
      const balance = await loyaltyService.getBalance(testUserId);
      expect(balance).toBe(50);
    });
  });
});
