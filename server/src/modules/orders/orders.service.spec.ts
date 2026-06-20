import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CourierService } from '../courier/courier.service';
import { MailService } from '../auth/mail.service';
import { DATABASE } from '@database/database.module';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_USER_ID = 'user-uuid-001';
const MOCK_ORDER_ID = 'order-uuid-001';

const mockOrder = {
  id: MOCK_ORDER_ID,
  userId: MOCK_USER_ID,
  status: 'pending',
  totalAmount: '200.00',
  shippingAddressId: 'addr-uuid-001',
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ─── Mock DB ──────────────────────────────────────────────────────────────────

/**
 * We must separate the root `db` object from the query builder chain.
 * If the root `db` has a `.then()` method, NestJS DI thinks it is a Promise
 * and automatically unwraps it during injection, causing `db.select` to be undefined.
 */
function makeMockDb(resolveQueue: any[][]) {
  let callIndex = 0;

  // The query builder chain (returned by select/insert/etc)
  const makeChain = (): any => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      offset: jest.fn().mockImplementation(() => {
        const r = resolveQueue[callIndex] ?? [];
        callIndex++;
        return Promise.resolve(r);
      }),
      insert: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      returning: jest.fn().mockImplementation(() => {
        const r = resolveQueue[callIndex] ?? [];
        callIndex++;
        return Promise.resolve(r);
      }),
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      // Awaiting the chain triggers .then()
      then: jest.fn((resolve: any, reject: any) => {
        const r = resolveQueue[callIndex] ?? [];
        callIndex++;
        return Promise.resolve(r).then(resolve, reject);
      }),
    };
    return chain;
  };

  // The root db injected into the service (NO .then())
  return {
    select: jest.fn(() => makeChain()),
    insert: jest.fn(() => makeChain()),
    update: jest.fn(() => makeChain()),
    delete: jest.fn(() => makeChain()),
    transaction: jest.fn((fn: any) => fn(makeChain())),
  };
}

// ─── Service factory ──────────────────────────────────────────────────────────

async function buildService(resolveQueue: any[][]): Promise<OrdersService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      OrdersService,
      {
        provide: DATABASE,
        useValue: makeMockDb(resolveQueue),
      },

      {
        provide: CourierService,
        useValue: {
          createConsignment: jest
            .fn()
            .mockResolvedValue({ tracking_code: 'TRK001' }),
        },
      },
      {
        provide: MailService,
        useValue: {
          sendOrderConfirmation: jest.fn().mockResolvedValue(undefined),
          sendLowStockAlert: jest.fn().mockResolvedValue(undefined),
        },
      },
    ],
  }).compile();

  return module.get<OrdersService>(OrdersService);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('OrdersService', () => {
  const checkoutDto = {
    addressLine1: '123 Street',
    city: 'Dhaka',
    district: 'Dhaka',
    phone: '01700000000',
  };

  describe('createOrderFromCart', () => {
    it('throws BadRequestException when cart is empty', async () => {
      // 1st then() → []
      const service = await buildService([[]]);
      await expect(
        service.createOrderFromCart(MOCK_USER_ID, checkoutDto as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when stock is insufficient', async () => {
      const lowStock = [
        {
          id: 'ci-1',
          productId: 'prod-1',
          quantity: 10,
          productPrice: '50.00',
          productStock: 2,
          productName: 'Widget',
        },
      ];
      // 1st then() → low stock cart
      const service = await buildService([lowStock]);
      await expect(
        service.createOrderFromCart(MOCK_USER_ID, checkoutDto as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getUserOrders', () => {
    it('resolves via offset() with orders', async () => {
      // getUserOrders is terminal at .offset()
      const service = await buildService([[mockOrder]]);
      const result = await service.getUserOrders(MOCK_USER_ID, 1, 10);
      expect(result).toEqual([mockOrder]);
    });

    it('resolves with empty array when no orders', async () => {
      const service = await buildService([[]]);
      const result = await service.getUserOrders(MOCK_USER_ID, 1, 10);
      expect(result).toEqual([]);
    });
  });

  describe('getOrderDetails', () => {
    it('throws NotFoundException when order not found', async () => {
      // 1st then() → order = []
      const service = await buildService([[]]);
      await expect(
        service.getOrderDetails(MOCK_USER_ID, MOCK_ORDER_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns order with items when found', async () => {
      // 1st then() → [order]; 2nd then() → items []
      const service = await buildService([[mockOrder], []]);
      const result = await service.getOrderDetails(MOCK_USER_ID, MOCK_ORDER_ID);
      expect(result).toMatchObject({ id: MOCK_ORDER_ID, items: [] });
    });
  });

  describe('updateOrderStatus', () => {
    it('throws BadRequestException immediately for invalid status', async () => {
      const service = await buildService([]);
      await expect(
        service.updateOrderStatus(MOCK_ORDER_ID, 'bad_status' as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws when returning() resolves with empty (order not found)', async () => {
      // returning() → [] → service should throw
      const service = await buildService([[]]);
      await expect(
        service.updateOrderStatus(MOCK_ORDER_ID, 'processing'),
      ).rejects.toThrow();
    });
  });
});
