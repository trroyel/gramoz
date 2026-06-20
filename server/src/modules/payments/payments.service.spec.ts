import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { DATABASE } from '@database/database.module';
import { ConfigService } from '@nestjs/config';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_USER_ID = 'user-uuid-001';
const MOCK_ORDER_ID = 'order-uuid-001';
const MOCK_PAYMENT_ID = 'payment-uuid-001';

const mockPendingOrder = {
  id: MOCK_ORDER_ID,
  userId: MOCK_USER_ID,
  status: 'pending',
  totalAmount: '500.00',
  shippingAddressId: 'addr-uuid-001',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockPayment = {
  id: MOCK_PAYMENT_ID,
  orderId: MOCK_ORDER_ID,
  amount: '500.00',
  method: 'COD',
  status: 'pending',
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ─── Mock DB builder ──────────────────────────────────────────────────────────

/**
 * Each call to `db.select()...where()` resolves with the next item
 * from `resolveQueue`. This lets us simulate ordered DB calls:
 *   1st select → order row
 *   2nd select → payment row (or empty)
 */
function makeMockDb(resolveQueue: any[][]) {
  let callIndex = 0;

  const chain = () => ({
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockImplementation(function (this: any) {
      const resolved = resolveQueue[callIndex] ?? [];
      callIndex++;
      return Promise.resolve(resolved);
    }),
    insert: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    returning: jest.fn().mockImplementation(() => {
      const resolved = resolveQueue[callIndex] ?? [];
      callIndex++;
      return Promise.resolve(resolved);
    }),
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    offset: jest.fn().mockReturnThis(),
    transaction: jest.fn((fn: any) => fn(chain())),
  });

  return chain();
}

const sandboxConfig = {
  get: (key: string) => {
    const map: Record<string, string> = {
      SSLCOMMERZ_STORE_ID: 'test-store',
      SSLCOMMERZ_STORE_SECRET: 'test-secret',
      SSLCOMMERZ_IS_SANDBOX: 'true',
    };
    return map[key] ?? undefined;
  },
};

const productionConfig = {
  get: (key: string) => {
    if (key === 'SSLCOMMERZ_IS_SANDBOX') return 'false';
    return 'test';
  },
};

async function buildService(
  resolveQueue: any[][],
  config = sandboxConfig,
): Promise<PaymentsService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      PaymentsService,
      { provide: DATABASE, useValue: makeMockDb(resolveQueue) },
      { provide: ConfigService, useValue: config },
    ],
  }).compile();
  return module.get<PaymentsService>(PaymentsService);
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('PaymentsService', () => {
  // ── initiateCod ─────────────────────────────────────────────────────────────

  describe('initiateCod', () => {
    it('throws NotFoundException when order does not exist', async () => {
      const service = await buildService([[]]); // 1st select → []
      await expect(
        service.initiateCod(MOCK_USER_ID, MOCK_ORDER_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when order belongs to another user', async () => {
      const otherOrder = { ...mockPendingOrder, userId: 'other-user' };
      const service = await buildService([[otherOrder]]);
      await expect(
        service.initiateCod(MOCK_USER_ID, MOCK_ORDER_ID),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException when order is not pending', async () => {
      const deliveredOrder = { ...mockPendingOrder, status: 'delivered' };
      const service = await buildService([[deliveredOrder]]);
      await expect(
        service.initiateCod(MOCK_USER_ID, MOCK_ORDER_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when payment already exists for order', async () => {
      // 1st select → pending order; 2nd select → existing payment
      const service = await buildService([[mockPendingOrder], [mockPayment]]);
      await expect(
        service.initiateCod(MOCK_USER_ID, MOCK_ORDER_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates and returns a COD payment record when all conditions pass', async () => {
      // 1st select → order; 2nd select → no existing payment; insert returning → new payment
      const service = await buildService([
        [mockPendingOrder],
        [],
        [mockPayment],
      ]);
      const result = await service.initiateCod(MOCK_USER_ID, MOCK_ORDER_ID);
      expect(result).toMatchObject({ method: 'COD', status: 'pending' });
    });
  });

  // ── verifyPayment / IPN ──────────────────────────────────────────────────────

  describe('verifyPayment', () => {
    it('handles FAILED IPN status without throwing', async () => {
      // handleFailedPayment does a select → returns empty (payment not found)
      const service = await buildService([[]]);
      const result = await service.verifyPayment({
        val_id: 'v1',
        tran_id: 'tran-001',
        status: 'FAILED',
      });
      expect(result).toBeDefined();
    });

    it('passes through in sandbox mode without checking signature', async () => {
      // sandbox skips signature check; after VALID status it queries payment → empty
      const service = await buildService([[], []]);
      await expect(
        service.verifyPayment({
          val_id: 'v1',
          tran_id: 'tran-001',
          status: 'VALID',
          verify_sign: 'WRONG',
          verify_key: 'tran_id',
        }),
      ).resolves.toBeDefined();
    });

    it('rejects IPN in production mode when verify_sign is missing', async () => {
      const service = await buildService([[]], productionConfig);
      const result = await service.verifyPayment({
        tran_id: 'tran-001',
        status: 'VALID',
        // no verify_sign / verify_key → signature check fails
      });
      expect(result).toMatchObject({ success: false });
    });
  });
});
