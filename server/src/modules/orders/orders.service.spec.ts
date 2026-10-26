/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import * as crypto from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { OrdersService } from './orders.service';
import { OrdersStore } from './orders.store';
import { PromosService } from '../promos/promos.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { SettingsService } from '../settings/settings.service';
import { CourierService } from '../courier/courier.service';
import { CreateOrderDto } from './dto/create-order.dto';
import {
  EntityNotFoundError,
  InvalidOperationError,
  InsufficientStockError,
  ForbiddenOperationError,
} from '../../common/errors/domain.errors';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_USER_ID = 'user-uuid-001';
const MOCK_ORDER_ID = 'order-uuid-001';
const MOCK_ADDRESS_ID = 'addr-uuid-001';

const mockAddress = {
  id: MOCK_ADDRESS_ID,
  userId: MOCK_USER_ID,
  title: 'Shipping Address',
  addressLine1: '123 Street',
  city: 'Dhaka',
  latitude: null,
  longitude: null,
  zoneId: null,
  isDefault: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockOrder = {
  id: MOCK_ORDER_ID,
  userId: MOCK_USER_ID,
  shippingAddressId: MOCK_ADDRESS_ID,
  totalAmount: '200.00',
  deliveryCharge: '0.00',
  deliveryMethod: 'home',
  status: 'pending' as const,
  promoId: null,
  discountAmount: '0',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockUser = {
  id: MOCK_USER_ID,
  email: 'customer@example.com',
  fullName: 'Customer Name',
  phone: '01700000000',
};

const mockCartItem = {
  id: 'cart-item-1',
  productId: 'prod-1',
  quantity: 2,
  productPrice: '100.00',
  productStock: 10,
  productName: 'Premium Item',
  variantId: null,
  variantPrice: null,
  variantStock: null,
  variantAttributes: null,
};

const mockVariantCartItem = {
  id: 'cart-item-2',
  productId: 'prod-2',
  quantity: 1,
  productPrice: '150.00',
  productStock: 20,
  productName: 'Variant Item',
  variantId: 'var-1',
  variantPrice: '140.00',
  variantStock: 5,
  variantAttributes: { size: 'M', color: 'Blue' },
};

const checkoutDto: CreateOrderDto = {
  addressLine1: '123 Street',
  city: 'Dhaka',
  phone: '01700000000',
};

// ─── Mock Factories ───────────────────────────────────────────────────────────

type MockOrdersStore = {
  getCartItemsCount: jest.Mock;
  acquireUserCheckoutLock: jest.Mock;
  findIdempotencyKey: jest.Mock;
  findIdempotencyKeyForUpdate: jest.Mock;
  createIdempotencyKey: jest.Mock;
  updateIdempotencyKey: jest.Mock;
  runTransaction: jest.Mock;
  getCartItemsWithProducts: jest.Mock;
  deleteCartItemsByUserId: jest.Mock;
  findAddress: jest.Mock;
  createAddress: jest.Mock;
  updateAddressZone: jest.Mock;
  createOrder: jest.Mock;
  createOrderItem: jest.Mock;
  createOrderItems?: jest.Mock;
  deductProductStock: jest.Mock;
  deductVariantStock: jest.Mock;
  createInventoryTransaction: jest.Mock;
  createInventoryTransactions?: jest.Mock;
  incrementPromoUsage: jest.Mock;
  getUserBasicInfo: jest.Mock;
  createOutboxEvent: jest.Mock;
  createOutboxEvents?: jest.Mock;
  getUserOrdersWithPayments: jest.Mock;
  getOrderDetailsWithPayments: jest.Mock;
  getOrderItemsWithProducts: jest.Mock;
  getOrderDetailsAsAdmin: jest.Mock;
  getLatestPaymentByOrderId: jest.Mock;
  getAllOrdersWithRelationsAsAdmin: jest.Mock;
  updateOrderStatus: jest.Mock;
  findOrderById: jest.Mock;
  findOrderByIdForUpdate: jest.Mock;
  restoreProductStock: jest.Mock;
  restoreVariantStock: jest.Mock;
  decrementPromoUsage: jest.Mock;
  getPointsSpentOnOrder: jest.Mock;
  hasPointsBeenRefunded: jest.Mock;
  getOrderItemsForRestock: jest.Mock;
  transitionOrderStatusForCancellation: jest.Mock;
  failPendingPaymentsForOrder: jest.Mock;
  findStaleUnpaidOrdersForExpiry: jest.Mock;
};

const createMockOrdersStore = (): MockOrdersStore => ({
  getCartItemsCount: jest.fn().mockResolvedValue(1),
  acquireUserCheckoutLock: jest.fn().mockResolvedValue(undefined),
  findIdempotencyKey: jest.fn().mockResolvedValue(null),
  findIdempotencyKeyForUpdate: jest.fn().mockResolvedValue(null),
  createIdempotencyKey: jest
    .fn()
    .mockImplementation((data) =>
      Promise.resolve({ id: 'idemp-uuid-001', ...data }),
    ),
  updateIdempotencyKey: jest.fn().mockResolvedValue({ id: 'idemp-uuid-001' }),
  runTransaction: jest.fn((cb: (tx: unknown) => Promise<unknown>) =>
    Promise.resolve(cb({})),
  ),
  getCartItemsWithProducts: jest.fn(),
  deleteCartItemsByUserId: jest.fn().mockResolvedValue(undefined),
  findAddress: jest.fn(),
  createAddress: jest.fn().mockResolvedValue(mockAddress),
  updateAddressZone: jest
    .fn()
    .mockImplementation((id: string, zoneId: string) =>
      Promise.resolve({ ...mockAddress, id, zoneId }),
    ),
  createOrder: jest.fn(),
  createOrderItem: jest.fn().mockResolvedValue(undefined),
  deductProductStock: jest.fn().mockResolvedValue(true),
  deductVariantStock: jest.fn().mockResolvedValue(true),
  createInventoryTransaction: jest.fn().mockResolvedValue(undefined),
  incrementPromoUsage: jest.fn().mockResolvedValue(true),
  getUserBasicInfo: jest.fn().mockResolvedValue(mockUser),
  createOutboxEvent: jest.fn().mockResolvedValue(undefined),
  getUserOrdersWithPayments: jest.fn(),
  getOrderDetailsWithPayments: jest.fn(),
  getOrderItemsWithProducts: jest.fn(),
  getOrderDetailsAsAdmin: jest.fn(),
  getLatestPaymentByOrderId: jest.fn(),
  getAllOrdersWithRelationsAsAdmin: jest.fn(),
  updateOrderStatus: jest.fn(),
  findOrderById: jest.fn().mockResolvedValue(mockOrder),
  findOrderByIdForUpdate: jest.fn().mockResolvedValue(mockOrder),
  restoreProductStock: jest.fn().mockResolvedValue(undefined),
  restoreVariantStock: jest.fn().mockResolvedValue(undefined),
  decrementPromoUsage: jest.fn().mockResolvedValue(undefined),
  getPointsSpentOnOrder: jest.fn().mockResolvedValue(0),
  hasPointsBeenRefunded: jest.fn().mockResolvedValue(false),
  getOrderItemsForRestock: jest.fn().mockResolvedValue([]),
  transitionOrderStatusForCancellation: jest
    .fn()
    .mockResolvedValue({ ...mockOrder, status: 'cancelled' }),
  failPendingPaymentsForOrder: jest.fn().mockResolvedValue(undefined),
  findStaleUnpaidOrdersForExpiry: jest.fn().mockResolvedValue([]),
});

const createMockPromosService = () => ({
  validate: jest.fn(),
});

const createMockLoyaltyService = () => ({
  getBalance: jest.fn().mockResolvedValue(0),
  spendPoints: jest.fn().mockResolvedValue(undefined),
  refundPoints: jest.fn().mockResolvedValue(undefined),
});

const createMockSettingsService = () => ({
  getPointsToCurrencyRatio: jest.fn().mockResolvedValue(10),
  getCheckoutExpiryMinutes: jest.fn().mockResolvedValue(30),
});

const createMockCourierService = () => ({
  calculateCharge: jest.fn().mockResolvedValue({ charge: 60 }),
  createConsignment: jest.fn().mockResolvedValue({ tracking_code: 'TRK001' }),
});

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('OrdersService', () => {
  let service: OrdersService;
  let mockStore: MockOrdersStore;
  let mockPromos: ReturnType<typeof createMockPromosService>;
  let mockLoyalty: ReturnType<typeof createMockLoyaltyService>;
  let mockSettings: ReturnType<typeof createMockSettingsService>;
  let mockCourier: ReturnType<typeof createMockCourierService>;

  beforeEach(async () => {
    mockStore = createMockOrdersStore();
    mockPromos = createMockPromosService();
    mockLoyalty = createMockLoyaltyService();
    mockSettings = createMockSettingsService();
    mockCourier = createMockCourierService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: OrdersStore, useValue: mockStore },
        { provide: PromosService, useValue: mockPromos },
        { provide: LoyaltyService, useValue: mockLoyalty },
        { provide: SettingsService, useValue: mockSettings },
        { provide: CourierService, useValue: mockCourier },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── createOrderFromCart ─────────────────────────────────────────────────────

  describe('createOrderFromCart', () => {
    it('throws InvalidOperationError when cart is empty', async () => {
      mockStore.getCartItemsWithProducts.mockResolvedValue([]);

      await expect(
        service.createOrderFromCart(MOCK_USER_ID, checkoutDto),
      ).rejects.toThrow(InvalidOperationError);
      expect(mockStore.getCartItemsWithProducts).toHaveBeenCalledWith(
        MOCK_USER_ID,
        expect.anything(),
      );
    });

    it('throws InsufficientStockError when standard product stock is insufficient', async () => {
      mockStore.getCartItemsWithProducts.mockResolvedValue([
        { ...mockCartItem, productStock: 1, quantity: 5 },
      ]);

      await expect(
        service.createOrderFromCart(MOCK_USER_ID, checkoutDto),
      ).rejects.toThrow(InsufficientStockError);
    });

    it('throws InsufficientStockError when variant stock is insufficient', async () => {
      mockStore.getCartItemsWithProducts.mockResolvedValue([
        { ...mockVariantCartItem, variantStock: 0, quantity: 1 },
      ]);

      await expect(
        service.createOrderFromCart(MOCK_USER_ID, checkoutDto),
      ).rejects.toThrow(InsufficientStockError);
    });

    it('throws InsufficientStockError if race condition occurs during deductProductStock', async () => {
      mockStore.getCartItemsWithProducts.mockResolvedValue([mockCartItem]);
      mockStore.findAddress.mockResolvedValue(mockAddress);
      mockStore.createOrder.mockResolvedValue(mockOrder);
      mockStore.deductProductStock.mockResolvedValue(false); // Stock was taken concurrently!

      await expect(
        service.createOrderFromCart(MOCK_USER_ID, checkoutDto),
      ).rejects.toThrow(InsufficientStockError);
    });

    it('throws InsufficientStockError if race condition occurs during deductVariantStock', async () => {
      mockStore.getCartItemsWithProducts.mockResolvedValue([
        mockVariantCartItem,
      ]);
      mockStore.findAddress.mockResolvedValue(mockAddress);
      mockStore.createOrder.mockResolvedValue(mockOrder);
      mockStore.deductVariantStock.mockResolvedValue(false);

      await expect(
        service.createOrderFromCart(MOCK_USER_ID, checkoutDto),
      ).rejects.toThrow(InsufficientStockError);
    });

    it('successfully creates order with new address, deducts stock, and creates outbox events', async () => {
      mockStore.getCartItemsWithProducts.mockResolvedValue([mockCartItem]);
      mockStore.findAddress.mockResolvedValue(null);
      mockStore.createAddress.mockResolvedValue(mockAddress);
      mockStore.createOrder.mockResolvedValue(mockOrder);
      mockStore.deductProductStock.mockResolvedValue(true);

      const result = await service.createOrderFromCart(
        MOCK_USER_ID,
        checkoutDto,
      );

      expect(mockStore.createAddress).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: MOCK_USER_ID,
          addressLine1: '123 Street',
          city: 'Dhaka',
        }),
        expect.anything(),
      );
      expect(mockStore.createOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: MOCK_USER_ID,
          shippingAddressId: mockAddress.id,
          status: 'pending',
        }),
        expect.anything(),
      );
      expect(mockStore.deductProductStock).toHaveBeenCalledWith(
        mockCartItem.productId,
        mockCartItem.quantity,
        expect.anything(),
      );
      expect(mockStore.createInventoryTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          productId: mockCartItem.productId,
          type: 'out',
          quantity: mockCartItem.quantity,
          referenceId: mockOrder.id,
        }),
        expect.anything(),
      );
      expect(mockStore.deleteCartItemsByUserId).toHaveBeenCalledWith(
        MOCK_USER_ID,
        expect.anything(),
      );
      expect(mockStore.createOutboxEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SEND_ORDER_CONFIRMATION',
          payload: expect.objectContaining({ orderId: mockOrder.id }),
        }),
        expect.anything(),
      );
      expect(mockStore.createOutboxEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SEND_LOW_STOCK_ALERT',
          payload: { productIds: [mockCartItem.productId] },
        }),
        expect.anything(),
      );
      expect(result).toEqual(mockOrder);
    });

    it('reuses existing address when addressLine1 and city match', async () => {
      mockStore.getCartItemsWithProducts.mockResolvedValue([mockCartItem]);
      mockStore.findAddress.mockResolvedValue(mockAddress);
      mockStore.createOrder.mockResolvedValue(mockOrder);

      await service.createOrderFromCart(MOCK_USER_ID, checkoutDto);

      expect(mockStore.createAddress).not.toHaveBeenCalled();
      expect(mockStore.createOrder).toHaveBeenCalledWith(
        expect.objectContaining({ shippingAddressId: mockAddress.id }),
        expect.anything(),
      );
    });

    it('backfills zoneId when existing address has no zoneId and dto includes zoneId', async () => {
      mockStore.getCartItemsWithProducts.mockResolvedValue([mockCartItem]);
      mockStore.findAddress.mockResolvedValue({ ...mockAddress, zoneId: null });
      mockStore.updateAddressZone.mockResolvedValue({
        ...mockAddress,
        zoneId: 'zone-dhaka-1',
      });
      mockStore.createOrder.mockResolvedValue(mockOrder);

      await service.createOrderFromCart(MOCK_USER_ID, {
        ...checkoutDto,
        zoneId: 'zone-dhaka-1',
      });

      expect(mockStore.updateAddressZone).toHaveBeenCalledWith(
        mockAddress.id,
        'zone-dhaka-1',
        expect.anything(),
      );
    });

    it('calculates delivery charge when zoneId and deliveryMethod are provided', async () => {
      mockStore.getCartItemsWithProducts.mockResolvedValue([mockCartItem]);
      mockStore.findAddress.mockResolvedValue(mockAddress);
      mockStore.createOrder.mockResolvedValue(mockOrder);
      mockCourier.calculateCharge.mockResolvedValue({ charge: 80 });

      await service.createOrderFromCart(MOCK_USER_ID, {
        ...checkoutDto,
        zoneId: 'zone-dhaka-1',
        deliveryMethod: 'home',
      });

      expect(mockCourier.calculateCharge).toHaveBeenCalledWith(
        'zone-dhaka-1',
        'home',
        0.5,
      );
      expect(mockStore.createOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryCharge: '80.00',
          deliveryMethod: 'home',
        }),
        expect.anything(),
      );
    });

    it('validates and applies promo discount when promoCode is provided', async () => {
      mockStore.getCartItemsWithProducts.mockResolvedValue([mockCartItem]); // 2 * 100 = 200
      mockStore.findAddress.mockResolvedValue(mockAddress);
      mockStore.createOrder.mockResolvedValue(mockOrder);
      mockPromos.validate.mockResolvedValue({
        promoId: 'promo-save-50',
        discountAmount: 50,
      });

      await service.createOrderFromCart(MOCK_USER_ID, {
        ...checkoutDto,
        promoCode: 'SAVE50',
      });

      expect(mockPromos.validate).toHaveBeenCalledWith({
        code: 'SAVE50',
        subtotal: 200,
      });
      expect(mockStore.incrementPromoUsage).toHaveBeenCalledWith(
        'promo-save-50',
        expect.anything(),
      );
      expect(mockStore.createOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          promoId: 'promo-save-50',
          discountAmount: '50',
          totalAmount: '150.00',
        }),
        expect.anything(),
      );
    });

    it('throws InvalidOperationError if promo code reaches usage limit during order transaction', async () => {
      mockStore.getCartItemsWithProducts.mockResolvedValue([mockCartItem]);
      mockStore.findAddress.mockResolvedValue(mockAddress);
      mockStore.createOrder.mockResolvedValue(mockOrder);
      mockPromos.validate.mockResolvedValue({
        promoId: 'promo-save-50',
        discountAmount: 50,
      });
      mockStore.incrementPromoUsage.mockResolvedValue(false); // Max uses reached!

      await expect(
        service.createOrderFromCart(MOCK_USER_ID, {
          ...checkoutDto,
          promoCode: 'SAVE50',
        }),
      ).rejects.toThrow('This promo code just reached its usage limit');
    });

    it('redeems loyalty points when usePoints is true', async () => {
      mockStore.getCartItemsWithProducts.mockResolvedValue([mockCartItem]); // 200 BDT
      mockStore.findAddress.mockResolvedValue(mockAddress);
      mockStore.createOrder.mockResolvedValue(mockOrder);
      mockLoyalty.getBalance.mockResolvedValue(500); // 500 points
      mockSettings.getPointsToCurrencyRatio.mockResolvedValue(10); // 10 points = 1 BDT -> 50 BDT value

      await service.createOrderFromCart(MOCK_USER_ID, {
        ...checkoutDto,
        usePoints: true,
      });

      expect(mockLoyalty.getBalance).toHaveBeenCalledWith(MOCK_USER_ID);
      expect(mockSettings.getPointsToCurrencyRatio).toHaveBeenCalled();
      expect(mockLoyalty.spendPoints).toHaveBeenCalledWith(
        MOCK_USER_ID,
        500,
        mockOrder.id,
        expect.anything(),
      );
      expect(mockStore.createOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          discountAmount: '50',
          totalAmount: '150.00',
        }),
        expect.anything(),
      );
    });

    it('caps loyalty points spent when points balance exceeds total order amount', async () => {
      mockStore.getCartItemsWithProducts.mockResolvedValue([mockCartItem]); // 200 BDT
      mockStore.findAddress.mockResolvedValue(mockAddress);
      mockStore.createOrder.mockResolvedValue(mockOrder);
      mockLoyalty.getBalance.mockResolvedValue(5000); // 5000 points = 500 BDT value (exceeds 200 BDT)
      mockSettings.getPointsToCurrencyRatio.mockResolvedValue(10);

      await service.createOrderFromCart(MOCK_USER_ID, {
        ...checkoutDto,
        usePoints: true,
      });

      // Points to use = 200 * 10 = 2000 points
      expect(mockLoyalty.spendPoints).toHaveBeenCalledWith(
        MOCK_USER_ID,
        2000,
        mockOrder.id,
        expect.anything(),
      );
      expect(mockStore.createOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          discountAmount: '200',
          totalAmount: '0.00',
        }),
        expect.anything(),
      );
    });

    it('serializes checkout using transaction-scoped user advisory lock', async () => {
      mockStore.getCartItemsWithProducts.mockResolvedValue([mockCartItem]);
      mockStore.createOrder.mockResolvedValue(mockOrder);

      await service.createOrderFromCart(MOCK_USER_ID, checkoutDto);

      expect(mockStore.acquireUserCheckoutLock).toHaveBeenCalledWith(
        MOCK_USER_ID,
        expect.anything(),
      );
    });

    it('returns existing order without duplicating order or deducting stock on valid idempotency replay', async () => {
      const idempotencyKey = 'key-uuid-123';
      const normalizedPayload = {
        addressLine1: checkoutDto.addressLine1.trim(),
        city: checkoutDto.city.trim(),
        phone: checkoutDto.phone.trim(),
        promoCode: null,
        usePoints: false,
        zoneId: null,
        deliveryMethod: 'home',
      };
      const validHash = crypto
        .createHash('sha256')
        .update(JSON.stringify(normalizedPayload))
        .digest('hex');

      mockStore.findIdempotencyKeyForUpdate.mockResolvedValue({
        id: 'idemp-1',
        userId: MOCK_USER_ID,
        key: idempotencyKey,
        requestHash: validHash,
        status: 'completed',
        orderId: mockOrder.id,
      });
      mockStore.findOrderById.mockResolvedValue(mockOrder);

      const order = await service.createOrderFromCart(
        MOCK_USER_ID,
        checkoutDto,
        idempotencyKey,
      );

      expect(order).toEqual(mockOrder);
      // Cart items were never read and stock was never deducted
      expect(mockStore.getCartItemsWithProducts).not.toHaveBeenCalled();
      expect(mockStore.createOrder).not.toHaveBeenCalled();
      expect(mockStore.deductProductStock).not.toHaveBeenCalled();
    });

    it('rejects reuse of the same idempotency key with different request payload parameters', async () => {
      const idempotencyKey = 'key-uuid-123';
      mockStore.findIdempotencyKeyForUpdate.mockResolvedValue({
        id: 'idemp-1',
        userId: MOCK_USER_ID,
        key: idempotencyKey,
        requestHash: 'different-sha256-hash',
        status: 'completed',
        orderId: mockOrder.id,
      });

      await expect(
        service.createOrderFromCart(MOCK_USER_ID, checkoutDto, idempotencyKey),
      ).rejects.toThrow(
        'Idempotency key has already been used with different request parameters',
      );
    });

    it('creates idempotency record with status started and marks completed on success', async () => {
      const idempotencyKey = 'key-new-456';
      mockStore.getCartItemsWithProducts.mockResolvedValue([mockCartItem]);
      mockStore.createOrder.mockResolvedValue(mockOrder);
      mockStore.findIdempotencyKeyForUpdate.mockResolvedValue(null);

      await service.createOrderFromCart(
        MOCK_USER_ID,
        checkoutDto,
        idempotencyKey,
      );

      expect(mockStore.createIdempotencyKey).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: MOCK_USER_ID,
          key: idempotencyKey,
          status: 'started',
        }),
        expect.anything(),
      );

      expect(mockStore.updateIdempotencyKey).toHaveBeenCalledWith(
        'idemp-uuid-001',
        expect.objectContaining({
          status: 'completed',
          orderId: mockOrder.id,
        }),
        expect.anything(),
      );
    });

    it('pre-computes courier delivery charge prior to opening write transaction (TASK-10)', async () => {
      mockStore.getCartItemsWithProducts.mockResolvedValue([mockCartItem]);
      mockStore.createOrder.mockResolvedValue(mockOrder);
      mockStore.getCartItemsCount.mockResolvedValue(2);
      mockCourier.calculateCharge.mockResolvedValue({
        charge: 80,
        estimatedDays: '2-3',
      });

      await service.createOrderFromCart(MOCK_USER_ID, {
        ...checkoutDto,
        zoneId: 'zone-1',
        deliveryMethod: 'branch',
      });

      expect(mockStore.getCartItemsCount).toHaveBeenCalledWith(MOCK_USER_ID);
      expect(mockCourier.calculateCharge).toHaveBeenCalledWith(
        'zone-1',
        'branch',
        1.0,
      );
    });

    it('deducts inventory in canonical sorted order by identifier to prevent deadlocks', async () => {
      const itemZ = {
        ...mockCartItem,
        productId: 'prod-Z',
        variantId: 'var-Z',
        variantStock: 5,
        quantity: 1,
      };
      const itemA = {
        ...mockCartItem,
        productId: 'prod-A',
        variantId: 'var-A',
        variantStock: 5,
        quantity: 1,
      };
      const itemM = {
        ...mockCartItem,
        productId: 'prod-M',
        variantId: null,
        productStock: 5,
        quantity: 1,
      };

      // Pass in reverse order: [Z, M, A]
      mockStore.getCartItemsWithProducts.mockResolvedValue([
        itemZ,
        itemM,
        itemA,
      ]);
      mockStore.createOrder.mockResolvedValue(mockOrder);

      await service.createOrderFromCart(MOCK_USER_ID, checkoutDto);

      // Verify deduction order was sorted: var-A, prod-M, var-Z
      const variantCalls = mockStore.deductVariantStock.mock.calls;
      const productCalls = mockStore.deductProductStock.mock.calls;

      expect(variantCalls[0][0]).toBe('var-A');
      expect(productCalls[0][0]).toBe('prod-M');
      expect(variantCalls[1][0]).toBe('var-Z');
    });

    it('uses batched insertion methods (createOrderItems, createInventoryTransactions, createOutboxEvents) when available (TASK-10)', async () => {
      mockStore.createOrderItems = jest.fn().mockResolvedValue(undefined);
      mockStore.createInventoryTransactions = jest
        .fn()
        .mockResolvedValue(undefined);
      mockStore.createOutboxEvents = jest.fn().mockResolvedValue(undefined);
      mockStore.getCartItemsWithProducts.mockResolvedValue([
        mockCartItem,
        mockVariantCartItem,
      ]);
      mockStore.createOrder.mockResolvedValue(mockOrder);

      await service.createOrderFromCart(MOCK_USER_ID, checkoutDto);

      // Verify batch insertions were invoked
      expect(mockStore.createOrderItems).toHaveBeenCalledTimes(1);
      expect(mockStore.createOrderItems).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            orderId: mockOrder.id,
            productId: mockCartItem.productId,
          }),
          expect.objectContaining({
            orderId: mockOrder.id,
            productId: mockVariantCartItem.productId,
            variantId: mockVariantCartItem.variantId,
          }),
        ]),
        expect.anything(),
      );

      expect(mockStore.createInventoryTransactions).toHaveBeenCalledTimes(1);
      expect(mockStore.createInventoryTransactions).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            referenceId: mockOrder.id,
            productId: mockCartItem.productId,
            type: 'out',
          }),
          expect.objectContaining({
            referenceId: mockOrder.id,
            productId: mockVariantCartItem.productId,
            type: 'out',
          }),
        ]),
        expect.anything(),
      );

      expect(mockStore.createOutboxEvents).toHaveBeenCalledTimes(1);
      expect(mockStore.createOutboxEvents).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ type: 'SEND_ORDER_CONFIRMATION' }),
        ]),
        expect.anything(),
      );

      // Individual methods should NOT have been called
      expect(mockStore.createOrderItem).not.toHaveBeenCalled();
      expect(mockStore.createInventoryTransaction).not.toHaveBeenCalled();
      expect(mockStore.createOutboxEvent).not.toHaveBeenCalled();
    });

    it('does not re-query courier calculateCharge inside transaction when precomputed charge is 0 (TASK-10)', async () => {
      mockStore.getCartItemsWithProducts.mockResolvedValue([mockCartItem]);
      mockStore.createOrder.mockResolvedValue({
        ...mockOrder,
        deliveryCharge: '0.00',
      });
      mockStore.getCartItemsCount.mockResolvedValue(1);
      mockCourier.calculateCharge.mockResolvedValue({
        charge: 0,
        estimatedDays: '1-2',
      });

      await service.createOrderFromCart(MOCK_USER_ID, {
        ...checkoutDto,
        zoneId: 'zone-free-pickup',
        deliveryMethod: 'branch',
      });

      // calculateCharge was called exactly once outside transaction, never inside transaction
      expect(mockCourier.calculateCharge).toHaveBeenCalledTimes(1);
      expect(mockStore.createOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryCharge: '0.00',
        }),
        expect.anything(),
      );
    });

    it('aborts checkout before opening write transaction if pre-transaction courier calculation throws (TASK-10)', async () => {
      mockStore.getCartItemsCount.mockResolvedValue(1);
      mockCourier.calculateCharge.mockRejectedValue(
        new EntityNotFoundError('Delivery zone not found'),
      );

      await expect(
        service.createOrderFromCart(MOCK_USER_ID, {
          ...checkoutDto,
          zoneId: 'invalid-zone-id',
          deliveryMethod: 'home',
        }),
      ).rejects.toThrow('Delivery zone not found');

      // Database transaction was never opened
      expect(mockStore.runTransaction).not.toHaveBeenCalled();
      expect(mockStore.acquireUserCheckoutLock).not.toHaveBeenCalled();
      expect(mockStore.getCartItemsWithProducts).not.toHaveBeenCalled();
    });
  });

  // ── getUserOrders ───────────────────────────────────────────────────────────

  describe('getUserOrders', () => {
    it('resolves orders with payment mapped from first element of payments array', async () => {
      const orderFromStore = {
        ...mockOrder,
        payments: [{ id: 'pay-1', method: 'COD', status: 'pending' }],
      };
      mockStore.getUserOrdersWithPayments.mockResolvedValue([orderFromStore]);

      const result = await service.getUserOrders(MOCK_USER_ID, 2, 10);

      expect(mockStore.getUserOrdersWithPayments).toHaveBeenCalledWith(
        MOCK_USER_ID,
        10,
        10,
      );
      expect(result).toEqual([
        {
          ...mockOrder,
          payment: { id: 'pay-1', method: 'COD', status: 'pending' },
          payments: undefined,
        },
      ]);
    });

    it('resolves with empty array when user has no orders', async () => {
      mockStore.getUserOrdersWithPayments.mockResolvedValue([]);

      const result = await service.getUserOrders(MOCK_USER_ID, 1, 10);

      expect(result).toEqual([]);
    });
  });

  // ── getOrderDetails ─────────────────────────────────────────────────────────

  describe('getOrderDetails', () => {
    it('throws EntityNotFoundError when order not found', async () => {
      mockStore.getOrderDetailsWithPayments.mockResolvedValue(null);

      await expect(
        service.getOrderDetails(MOCK_USER_ID, MOCK_ORDER_ID),
      ).rejects.toThrow(EntityNotFoundError);
    });

    it('returns order with items and single payment when found', async () => {
      const orderWithPayments = {
        ...mockOrder,
        payments: [{ id: 'pay-1', method: 'COD', status: 'pending' }],
      };
      const items = [{ id: 'item-1', productName: 'Item 1', quantity: 1 }];

      mockStore.getOrderDetailsWithPayments.mockResolvedValue(
        orderWithPayments,
      );
      mockStore.getOrderItemsWithProducts.mockResolvedValue(items);

      const result = await service.getOrderDetails(MOCK_USER_ID, MOCK_ORDER_ID);

      expect(result).toEqual({
        ...mockOrder,
        payment: { id: 'pay-1', method: 'COD', status: 'pending' },
        items,
      });
    });
  });

  // ── getOrderDetailsAsAdmin ──────────────────────────────────────────────────

  describe('getOrderDetailsAsAdmin', () => {
    it('throws EntityNotFoundError when order not found as admin', async () => {
      mockStore.getOrderDetailsAsAdmin.mockResolvedValue(null);

      await expect(
        service.getOrderDetailsAsAdmin(MOCK_ORDER_ID),
      ).rejects.toThrow(EntityNotFoundError);
    });

    it('returns full admin order details with items and payment', async () => {
      const adminOrder = {
        id: MOCK_ORDER_ID,
        totalAmount: '200.00',
        customerName: 'Customer Name',
      };
      const items = [{ id: 'item-1', productName: 'Item 1' }];
      const payment = { id: 'pay-1', status: 'completed' };

      mockStore.getOrderDetailsAsAdmin.mockResolvedValue(adminOrder);
      mockStore.getOrderItemsWithProducts.mockResolvedValue(items);
      mockStore.getLatestPaymentByOrderId.mockResolvedValue(payment);

      const result = await service.getOrderDetailsAsAdmin(MOCK_ORDER_ID);

      expect(result).toEqual({
        ...adminOrder,
        items,
        payment,
      });
    });
  });

  // ── getAllOrdersAsAdmin ─────────────────────────────────────────────────────

  describe('getAllOrdersAsAdmin', () => {
    it('maps customerName and payment for admin list', async () => {
      mockStore.getAllOrdersWithRelationsAsAdmin.mockResolvedValue([
        {
          ...mockOrder,
          user: { fullName: 'Admin Customer' },
          payments: [{ id: 'pay-1', method: 'bKash' }],
        },
      ]);

      const result = await service.getAllOrdersAsAdmin(1, 20);

      expect(result).toEqual([
        {
          ...mockOrder,
          customerName: 'Admin Customer',
          payment: { id: 'pay-1', method: 'bKash' },
        },
      ]);
    });
  });

  // ── updateOrderStatus ───────────────────────────────────────────────────────

  describe('updateOrderStatus', () => {
    it('throws InvalidOperationError immediately for invalid status', async () => {
      await expect(
        service.updateOrderStatus(
          MOCK_ORDER_ID,
          'bad_status' as unknown as string,
        ),
      ).rejects.toThrow(InvalidOperationError);
      expect(mockStore.runTransaction).not.toHaveBeenCalled();
    });

    it('throws EntityNotFoundError when order does not exist', async () => {
      mockStore.findOrderByIdForUpdate.mockResolvedValue(null);

      await expect(
        service.updateOrderStatus(MOCK_ORDER_ID, 'processing'),
      ).rejects.toThrow(EntityNotFoundError);
    });

    it('rejects invalid status transitions in the state machine', async () => {
      // Cannot transition directly from pending to delivered
      mockStore.findOrderByIdForUpdate.mockResolvedValue({
        ...mockOrder,
        status: 'pending',
      });

      await expect(
        service.updateOrderStatus(MOCK_ORDER_ID, 'delivered'),
      ).rejects.toThrow(InvalidOperationError);

      // Cannot transition from delivered to processing
      mockStore.findOrderByIdForUpdate.mockResolvedValue({
        ...mockOrder,
        status: 'delivered',
      });

      await expect(
        service.updateOrderStatus(MOCK_ORDER_ID, 'processing'),
      ).rejects.toThrow(InvalidOperationError);
    });

    it('updates order status to processing without extra outbox events', async () => {
      mockStore.findOrderByIdForUpdate.mockResolvedValue({
        ...mockOrder,
        status: 'pending',
      });
      mockStore.updateOrderStatus.mockResolvedValue({
        ...mockOrder,
        status: 'processing',
      });

      const result = await service.updateOrderStatus(
        MOCK_ORDER_ID,
        'processing',
      );

      expect(mockStore.updateOrderStatus).toHaveBeenCalledWith(
        MOCK_ORDER_ID,
        'processing',
        expect.anything(),
      );
      expect(mockStore.createOutboxEvent).not.toHaveBeenCalled();
      expect(result.status).toBe('processing');
    });

    it('creates CREATE_CONSIGNMENT outbox event when status is changed to shipped', async () => {
      mockStore.findOrderByIdForUpdate.mockResolvedValue({
        ...mockOrder,
        status: 'processing',
      });
      mockStore.updateOrderStatus.mockResolvedValue({
        ...mockOrder,
        status: 'shipped',
      });

      const result = await service.updateOrderStatus(MOCK_ORDER_ID, 'shipped');

      expect(mockStore.createOutboxEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'CREATE_CONSIGNMENT',
          payload: { orderId: MOCK_ORDER_ID },
          status: 'pending',
        }),
        expect.anything(),
      );
      expect(result.status).toBe('shipped');
    });

    it('creates SEND_SMS outbox event when status is changed to delivered and customer has phone', async () => {
      mockStore.findOrderByIdForUpdate.mockResolvedValue({
        ...mockOrder,
        status: 'out_for_delivery',
      });
      mockStore.updateOrderStatus.mockResolvedValue({
        ...mockOrder,
        userId: MOCK_USER_ID,
        status: 'delivered',
      });
      mockStore.getUserBasicInfo.mockResolvedValue({
        fullName: 'Customer',
        email: 'c@example.com',
        phone: '01711111111',
      });

      const result = await service.updateOrderStatus(
        MOCK_ORDER_ID,
        'delivered',
      );

      expect(mockStore.createOutboxEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SEND_SMS',
          payload: {
            type: 'delivered',
            phone: '01711111111',
            orderId: MOCK_ORDER_ID,
          },
        }),
        expect.anything(),
      );
      expect(result.status).toBe('delivered');
    });

    it('does not create SEND_SMS outbox event on delivered when customer has no phone', async () => {
      mockStore.findOrderByIdForUpdate.mockResolvedValue({
        ...mockOrder,
        status: 'out_for_delivery',
      });
      mockStore.updateOrderStatus.mockResolvedValue({
        ...mockOrder,
        userId: MOCK_USER_ID,
        status: 'delivered',
      });
      mockStore.getUserBasicInfo.mockResolvedValue({
        fullName: 'Customer',
        email: 'c@example.com',
        phone: null,
      });

      await service.updateOrderStatus(MOCK_ORDER_ID, 'delivered');

      expect(mockStore.createOutboxEvent).not.toHaveBeenCalled();
    });
  });

  // ── cancelOrder & Inventory Restocking (TASK-03) ───────────────────────────

  describe('cancelOrder & Inventory Restocking (TASK-03)', () => {
    it('cancels eligible pending order, restores inventory, and logs audit', async () => {
      mockStore.findOrderById.mockResolvedValue({
        ...mockOrder,
        userId: MOCK_USER_ID,
        status: 'pending',
        promoId: 'promo-123',
      });
      mockStore.findOrderByIdForUpdate.mockResolvedValue({
        ...mockOrder,
        userId: MOCK_USER_ID,
        status: 'pending',
        promoId: 'promo-123',
      });
      mockStore.transitionOrderStatusForCancellation.mockResolvedValue({
        ...mockOrder,
        userId: MOCK_USER_ID,
        status: 'cancelled',
        promoId: 'promo-123',
      });
      mockStore.getOrderItemsForRestock.mockResolvedValue([
        { id: 'item-1', productId: 'prod-1', variantId: null, quantity: 2 },
        { id: 'item-2', productId: 'prod-2', variantId: 'var-1', quantity: 3 },
      ]);
      mockStore.getPointsSpentOnOrder.mockResolvedValue(50);
      mockStore.hasPointsBeenRefunded.mockResolvedValue(false);

      const result = await service.cancelOrder(
        MOCK_USER_ID,
        MOCK_ORDER_ID,
        'Changed mind',
      );

      expect(result.status).toBe('cancelled');

      // Product stock restored
      expect(mockStore.restoreProductStock).toHaveBeenCalledWith(
        'prod-1',
        2,
        expect.anything(),
      );

      // Variant stock restored
      expect(mockStore.restoreVariantStock).toHaveBeenCalledWith(
        'var-1',
        3,
        expect.anything(),
      );

      // Inventory audit transactions created with type 'in'
      expect(mockStore.createInventoryTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          productId: 'prod-1',
          type: 'in',
          quantity: 2,
          referenceId: MOCK_ORDER_ID,
        }),
        expect.anything(),
      );
      expect(mockStore.createInventoryTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          productId: 'prod-2',
          type: 'in',
          quantity: 3,
          referenceId: MOCK_ORDER_ID,
        }),
        expect.anything(),
      );

      // Promo usage restored
      expect(mockStore.decrementPromoUsage).toHaveBeenCalledWith(
        'promo-123',
        expect.anything(),
      );

      // Loyalty points refunded
      expect(mockLoyalty.refundPoints).toHaveBeenCalledWith(
        MOCK_USER_ID,
        50,
        MOCK_ORDER_ID,
        expect.anything(),
      );

      // Pending payments failed
      expect(mockStore.failPendingPaymentsForOrder).toHaveBeenCalledWith(
        MOCK_ORDER_ID,
        expect.anything(),
      );
    });

    it('rejects cancellation if order belongs to a different user', async () => {
      mockStore.findOrderById.mockResolvedValue({
        ...mockOrder,
        userId: 'other-user',
        status: 'pending',
      });

      await expect(
        service.cancelOrder(MOCK_USER_ID, MOCK_ORDER_ID),
      ).rejects.toThrow(ForbiddenOperationError);
      expect(
        mockStore.transitionOrderStatusForCancellation,
      ).not.toHaveBeenCalled();
    });

    it('rejects cancellation if order does not exist', async () => {
      mockStore.findOrderById.mockResolvedValue(null);

      await expect(
        service.cancelOrder(MOCK_USER_ID, MOCK_ORDER_ID),
      ).rejects.toThrow(EntityNotFoundError);
    });

    it('rejects cancellation if order is already cancelled (idempotency guard)', async () => {
      mockStore.findOrderById.mockResolvedValue({
        ...mockOrder,
        userId: MOCK_USER_ID,
        status: 'cancelled',
      });

      await expect(
        service.cancelOrder(MOCK_USER_ID, MOCK_ORDER_ID),
      ).rejects.toThrow(InvalidOperationError);

      expect(mockStore.restoreProductStock).not.toHaveBeenCalled();
      expect(mockStore.restoreVariantStock).not.toHaveBeenCalled();
      expect(mockLoyalty.refundPoints).not.toHaveBeenCalled();
    });

    it('rejects cancellation if order is already shipped or delivered', async () => {
      mockStore.findOrderById.mockResolvedValue({
        ...mockOrder,
        userId: MOCK_USER_ID,
        status: 'shipped',
      });

      await expect(
        service.cancelOrder(MOCK_USER_ID, MOCK_ORDER_ID),
      ).rejects.toThrow(InvalidOperationError);

      mockStore.findOrderById.mockResolvedValue({
        ...mockOrder,
        userId: MOCK_USER_ID,
        status: 'delivered',
      });

      await expect(
        service.cancelOrder(MOCK_USER_ID, MOCK_ORDER_ID),
      ).rejects.toThrow(InvalidOperationError);
    });

    it('does not re-refund loyalty points if they were already refunded', async () => {
      mockStore.findOrderById.mockResolvedValue({
        ...mockOrder,
        userId: MOCK_USER_ID,
        status: 'pending',
      });
      mockStore.findOrderByIdForUpdate.mockResolvedValue({
        ...mockOrder,
        userId: MOCK_USER_ID,
        status: 'pending',
      });
      mockStore.transitionOrderStatusForCancellation.mockResolvedValue({
        ...mockOrder,
        userId: MOCK_USER_ID,
        status: 'cancelled',
      });
      mockStore.getOrderItemsForRestock.mockResolvedValue([]);
      mockStore.getPointsSpentOnOrder.mockResolvedValue(100);
      mockStore.hasPointsBeenRefunded.mockResolvedValue(true); // already refunded

      await service.cancelOrder(MOCK_USER_ID, MOCK_ORDER_ID);

      expect(mockLoyalty.refundPoints).not.toHaveBeenCalled();
    });
  });

  // ── updateOrderStatus with cancelled (Admin) ───────────────────────────────

  describe('updateOrderStatus with cancelled (Admin)', () => {
    it('restocks inventory when admin updates status to cancelled', async () => {
      mockStore.findOrderByIdForUpdate.mockResolvedValue({
        ...mockOrder,
        status: 'processing',
      });
      mockStore.transitionOrderStatusForCancellation.mockResolvedValue({
        ...mockOrder,
        status: 'cancelled',
      });
      mockStore.getOrderItemsForRestock.mockResolvedValue([
        { id: 'item-1', productId: 'prod-1', variantId: null, quantity: 1 },
      ]);
      mockStore.getPointsSpentOnOrder.mockResolvedValue(0);

      const result = await service.updateOrderStatus(
        MOCK_ORDER_ID,
        'cancelled',
      );

      expect(result.status).toBe('cancelled');
      expect(mockStore.restoreProductStock).toHaveBeenCalledWith(
        'prod-1',
        1,
        expect.anything(),
      );
    });

    it('rejects admin cancellation on delivered order', async () => {
      mockStore.findOrderByIdForUpdate.mockResolvedValue({
        ...mockOrder,
        status: 'delivered',
      });

      await expect(
        service.updateOrderStatus(MOCK_ORDER_ID, 'cancelled'),
      ).rejects.toThrow(InvalidOperationError);
    });
  });

  // ── expireOrder (Stale Checkout Expiry) ─────────────────────────────────────

  describe('expireOrder (Stale Checkout Expiry)', () => {
    it('expires stale order and releases inventory with expiry audit notes', async () => {
      mockStore.findOrderByIdForUpdate.mockResolvedValue({
        ...mockOrder,
        status: 'pending',
      });
      mockStore.transitionOrderStatusForCancellation.mockResolvedValue({
        ...mockOrder,
        status: 'cancelled',
      });
      mockStore.getOrderItemsForRestock.mockResolvedValue([
        { id: 'item-1', productId: 'prod-1', variantId: null, quantity: 2 },
      ]);
      mockStore.getPointsSpentOnOrder.mockResolvedValue(0);

      const result = await service.expireOrder(
        MOCK_ORDER_ID,
        'Automated expiry (>30m)',
      );

      expect(result.status).toBe('cancelled');
      expect(mockStore.restoreProductStock).toHaveBeenCalledWith(
        'prod-1',
        2,
        expect.anything(),
      );
      expect(mockStore.createInventoryTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'in',
          notes: expect.stringContaining('Automated expiry (>30m)'),
        }),
        expect.anything(),
      );
    });
  });
});
