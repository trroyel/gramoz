import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { DATABASE } from '@database/database.module';
import { ConfigService } from '@nestjs/config';
import { EntityNotFoundError, ForbiddenOperationError, InvalidOperationError } from '../../common/errors/domain.errors';
import * as crypto from 'crypto';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_USER_ID = 'user-uuid-001';
const MOCK_ORDER_ID = 'order-uuid-001';
const MOCK_PAYMENT_ID = 'payment-uuid-001';

const mockPendingOrder = {
  id: MOCK_ORDER_ID,
  userId: MOCK_USER_ID,
  paymentStatus: 'unpaid',
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
    it('throws EntityNotFoundError when order does not exist', async () => {
      const service = await buildService([[]]); // 1st select → []
      await expect(
        service.initiateCod(MOCK_USER_ID, MOCK_ORDER_ID),
      ).rejects.toThrow(EntityNotFoundError);
    });

    it('throws ForbiddenOperationError when order belongs to another user', async () => {
      const otherOrder = { ...mockPendingOrder, userId: 'other-user' };
      const service = await buildService([[otherOrder]]);
      await expect(
        service.initiateCod(MOCK_USER_ID, MOCK_ORDER_ID),
      ).rejects.toThrow(ForbiddenOperationError);
    });

    it('throws InvalidOperationError when order is not pending', async () => {
      const initiatedOrder = { ...mockPendingOrder, paymentStatus: 'initiated' };
      const service = await buildService([[initiatedOrder]]);
      await expect(
        service.initiateCod(MOCK_USER_ID, MOCK_ORDER_ID),
      ).rejects.toThrow(InvalidOperationError);
    });

    it('creates and returns a COD payment record when all conditions pass', async () => {
      // 1st select → order; 2nd insert returning → new payment
      const service = await buildService([
        [mockPendingOrder],
        [mockPayment],
      ]);
      const result = await service.initiateCod(MOCK_USER_ID, MOCK_ORDER_ID);
      expect(result).toMatchObject({ method: 'COD', status: 'pending' });
    });
  });

  describe('verifyPayment & handleSuccessfulPayment', () => {
    // Helper to generate a valid SSLCommerz IPN signature for tests
    const generateValidSignature = (ipnData: Record<string, string>, storePasswd = 'test-secret') => {
      const keys = ipnData.verify_key.split(',');
      const parts = keys.map((key) => `${key}=${ipnData[key] ?? ''}`);
      const hashedPasswd = crypto.createHash('md5').update(storePasswd).digest('hex');
      parts.push(`store_passwd=${hashedPasswd}`);
      const hashString = parts.join('&');
      return crypto.createHash('md5').update(hashString).digest('hex');
    };

    beforeEach(() => {
      global.fetch = jest.fn();
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('rejects IPN unconditionally if verify_sign or verify_key is missing', async () => {
      const service = await buildService([[]], sandboxConfig); // Even in sandbox!
      const result = await service.verifyPayment({
        tran_id: 'tran-001',
        status: 'VALID',
        // missing verify_sign and verify_key
      });
      expect(result).toMatchObject({ success: false, message: 'Invalid IPN signature' });
    });

    it('rejects IPN unconditionally if verify_sign is invalid', async () => {
      const service = await buildService([[]], sandboxConfig);
      const result = await service.verifyPayment({
        tran_id: 'tran-001',
        status: 'VALID',
        verify_key: 'tran_id',
        verify_sign: 'WRONG_SIGNATURE_HASH',
      });
      expect(result).toMatchObject({ success: false, message: 'Invalid IPN signature' });
    });

    it('returns success: false if payment amount does not match IPN amount', async () => {
      // 1. Setup IPN data with a valid signature
      const ipnData = {
        val_id: 'v1',
        tran_id: MOCK_PAYMENT_ID,
        status: 'VALID',
        amount: '100.00', // IPN says 100
        verify_key: 'tran_id,amount',
      };
      const signature = generateValidSignature(ipnData);
      const signedIpn = { ...ipnData, verify_sign: signature };

      // 2. Mock fetch for the validation API call
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        json: async () => ({ status: 'VALIDATED', amount: '100.00' }), // Validation API says 100
      });

      // 3. Mock DB: payment row says 500 (tampering detected!)
      // 1st query in handleSuccessfulPayment -> select payment
      const dbPayment = { ...mockPayment, amount: '500.00', transactionId: MOCK_PAYMENT_ID };
      const service = await buildService([[dbPayment]], sandboxConfig);

      // 4. Assert
      const result = await service.verifyPayment(signedIpn);
      expect(result).toMatchObject({
        success: false,
        message: 'Payment amount mismatch — transaction rejected for security review',
      });
    });

    it('processes successful payment when signature and amount both match', async () => {
      const ipnData = {
        val_id: 'v1',
        tran_id: MOCK_PAYMENT_ID,
        status: 'VALID',
        amount: '500.00',
        verify_key: 'tran_id,amount',
      };
      const signedIpn = { ...ipnData, verify_sign: generateValidSignature(ipnData) };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        json: async () => ({ status: 'VALIDATED', amount: '500.00' }),
      });

      // DB calls in handleSuccessfulPayment:
      // 1. select payment -> returns payment (amount 500.00 matches)
      // 2. select order -> returns pending order
      // 3. tx.update(payments) -> returns updated payment
      // 4. tx.update(orders) -> returns updated order
      const service = await buildService(
        [[mockPayment], [mockPendingOrder], [mockPayment], [mockPendingOrder]],
        sandboxConfig,
      );

      const result = await service.verifyPayment(signedIpn);

      expect(result).toMatchObject({ success: true, message: 'Payment verified and order is now processing' });
    });
  });
});
