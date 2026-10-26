import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PaymentsService } from './payments.service';
import { PaymentsStore } from './payments.store';
import {
  EntityNotFoundError,
  ForbiddenOperationError,
  InvalidOperationError,
} from '../../common/errors/domain.errors';
import * as crypto from 'crypto';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_USER_ID = 'user-uuid-001';
const MOCK_ORDER_ID = 'order-uuid-001';
const MOCK_PAYMENT_ID = 'payment-uuid-001';
const MOCK_TRAN_ID = 'TRN_1234567890_order';

const mockPendingOrder = {
  id: MOCK_ORDER_ID,
  userId: MOCK_USER_ID,
  paymentStatus: 'unpaid' as const,
  totalAmount: '500.00',
  shippingAddressId: 'addr-uuid-001',
  status: 'pending' as const,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockUser = {
  id: MOCK_USER_ID,
  fullName: 'Test User',
  email: 'test@example.com',
  phone: '01700000000',
};

const mockPayment = {
  id: MOCK_PAYMENT_ID,
  orderId: MOCK_ORDER_ID,
  amount: '500.00',
  method: 'COD',
  status: 'pending' as const,
  transactionId: MOCK_TRAN_ID,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ─── Config Fixtures ──────────────────────────────────────────────────────────

const createMockConfig = (overrides: Record<string, string> = {}) => ({
  get: jest.fn((key: string) => {
    const map: Record<string, string> = {
      SSLCOMMERZ_STORE_ID: 'test-store',
      SSLCOMMERZ_STORE_SECRET: 'test-secret',
      SSLCOMMERZ_IS_SANDBOX: 'true',
      ...overrides,
    };
    return map[key] ?? undefined;
  }),
});

// ─── Mock PaymentsStore Factory ───────────────────────────────────────────────

type MockPaymentsStore = {
  runTransaction: jest.Mock;
  findOrderById: jest.Mock;
  findOrderByIdForUpdate: jest.Mock;
  updateOrderStatus: jest.Mock;
  findUserById: jest.Mock;
  findLatestPaymentByOrderId: jest.Mock;
  findLatestPendingPaymentByOrderId: jest.Mock;
  findPaymentByTransactionId: jest.Mock;
  createPayment: jest.Mock;
  updatePaymentStatus: jest.Mock;
};

const createMockPaymentsStore = (): MockPaymentsStore => ({
  runTransaction: jest.fn((cb: (tx: unknown) => Promise<unknown>) =>
    Promise.resolve(cb({})),
  ),
  findOrderById: jest.fn(),
  findOrderByIdForUpdate: jest
    .fn()
    .mockResolvedValue({ id: MOCK_ORDER_ID, status: 'pending' }),
  updateOrderStatus: jest.fn().mockResolvedValue(undefined),
  findUserById: jest.fn(),
  findLatestPaymentByOrderId: jest.fn(),
  findLatestPendingPaymentByOrderId: jest.fn(),
  findPaymentByTransactionId: jest.fn(),
  createPayment: jest.fn(),
  updatePaymentStatus: jest.fn().mockResolvedValue(undefined),
});

// Helper to generate a valid SSLCommerz IPN MD5 signature for tests
const generateValidMd5Signature = (
  ipnData: Record<string, string>,
  storePasswd = 'test-secret',
) => {
  const keys = ipnData.verify_key.split(',').map((k) => k.trim());
  const parts = keys.map((key) => `${key}=${ipnData[key] ?? ''}`);
  const baseHash = parts.join('&');
  const hashedPasswd = crypto
    .createHash('md5')
    .update(storePasswd)
    .digest('hex');
  const hashString = `${baseHash}&store_passwd=${hashedPasswd}`;
  return crypto.createHash('md5').update(hashString).digest('hex');
};

// Helper to generate a valid SSLCommerz IPN SHA256 signature
const generateValidSha256Signature = (
  ipnData: Record<string, string>,
  storePasswd = 'test-secret',
) => {
  const keys = ipnData.verify_key.split(',').map((k) => k.trim());
  const parts = keys.map((key) => `${key}=${ipnData[key] ?? ''}`);
  const baseHash = parts.join('&');
  const hashString = `${baseHash}&store_passwd=${storePasswd}`;
  return crypto.createHash('sha256').update(hashString).digest('hex');
};

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('PaymentsService', () => {
  let service: PaymentsService;
  let mockStore: MockPaymentsStore;
  let mockConfig: ReturnType<typeof createMockConfig>;

  const setupService = async (configOverrides: Record<string, string> = {}) => {
    mockStore = createMockPaymentsStore();
    mockConfig = createMockConfig(configOverrides);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PaymentsStore, useValue: mockStore },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
  };

  beforeEach(async () => {
    await setupService();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── initiateCod ─────────────────────────────────────────────────────────────

  describe('initiateCod', () => {
    it('throws EntityNotFoundError when order does not exist', async () => {
      mockStore.findOrderById.mockResolvedValue(null);

      await expect(
        service.initiateCod(MOCK_USER_ID, MOCK_ORDER_ID),
      ).rejects.toThrow(EntityNotFoundError);
      expect(mockStore.findOrderById).toHaveBeenCalledWith(MOCK_ORDER_ID);
    });

    it('throws ForbiddenOperationError when order belongs to another user', async () => {
      mockStore.findOrderById.mockResolvedValue({
        ...mockPendingOrder,
        userId: 'other-user',
      });

      await expect(
        service.initiateCod(MOCK_USER_ID, MOCK_ORDER_ID),
      ).rejects.toThrow(ForbiddenOperationError);
    });

    it('throws InvalidOperationError when order is already initiated, paid, or refunded', async () => {
      for (const status of ['initiated', 'paid', 'refunded']) {
        mockStore.findOrderById.mockResolvedValue({
          ...mockPendingOrder,
          paymentStatus: status,
        });

        await expect(
          service.initiateCod(MOCK_USER_ID, MOCK_ORDER_ID),
        ).rejects.toThrow(InvalidOperationError);
      }
    });

    it('creates and returns a COD payment record when all conditions pass', async () => {
      mockStore.findOrderById.mockResolvedValue(mockPendingOrder);
      mockStore.createPayment.mockResolvedValue(mockPayment);

      const result = await service.initiateCod(MOCK_USER_ID, MOCK_ORDER_ID);

      expect(mockStore.runTransaction).toHaveBeenCalled();
      expect(mockStore.createPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: MOCK_ORDER_ID,
          amount: '500.00',
          method: 'COD',
          status: 'pending',
        }),
        expect.anything(),
      );
      expect(mockStore.updateOrderStatus).toHaveBeenCalledWith(
        MOCK_ORDER_ID,
        { paymentStatus: 'initiated' },
        expect.anything(),
      );
      expect(result).toEqual(mockPayment);
    });
  });

  // ── initiatePayment ─────────────────────────────────────────────────────────

  describe('initiatePayment', () => {
    it('throws EntityNotFoundError when order not found', async () => {
      mockStore.findOrderById.mockResolvedValue(null);

      await expect(
        service.initiatePayment(
          MOCK_USER_ID,
          MOCK_ORDER_ID,
          'http://localhost:3000',
        ),
      ).rejects.toThrow(EntityNotFoundError);
    });

    it('throws ForbiddenOperationError when order belongs to someone else', async () => {
      mockStore.findOrderById.mockResolvedValue({
        ...mockPendingOrder,
        userId: 'intruder',
      });

      await expect(
        service.initiatePayment(
          MOCK_USER_ID,
          MOCK_ORDER_ID,
          'http://localhost:3000',
        ),
      ).rejects.toThrow(ForbiddenOperationError);
    });

    it('throws InvalidOperationError when order is already paid or refunded', async () => {
      mockStore.findOrderById.mockResolvedValue({
        ...mockPendingOrder,
        paymentStatus: 'paid',
      });

      await expect(
        service.initiatePayment(
          MOCK_USER_ID,
          MOCK_ORDER_ID,
          'http://localhost:3000',
        ),
      ).rejects.toThrow(InvalidOperationError);
    });

    it('auto-cancels stale pending payment and allows retry when paymentStatus is initiated', async () => {
      mockStore.findOrderById.mockResolvedValue({
        ...mockPendingOrder,
        paymentStatus: 'initiated',
      });
      mockStore.findLatestPaymentByOrderId.mockResolvedValue({
        id: 'stale-payment-1',
        status: 'pending',
      });
      mockStore.findUserById.mockResolvedValue(mockUser);
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            status: 'SUCCESS',
            GatewayPageURL: 'https://sandbox.sslcommerz.com/easycheckout/test',
          }),
      });

      const result = await service.initiatePayment(
        MOCK_USER_ID,
        MOCK_ORDER_ID,
        'http://localhost:3000',
      );

      expect(mockStore.updatePaymentStatus).toHaveBeenCalledWith(
        'stale-payment-1',
        { status: 'failed' },
        expect.anything(),
      );
      expect(result).toEqual({
        gatewayUrl: 'https://sandbox.sslcommerz.com/easycheckout/test',
      });
    });

    it('throws InvalidOperationError when initiated order has non-pending payment in progress', async () => {
      mockStore.findOrderById.mockResolvedValue({
        ...mockPendingOrder,
        paymentStatus: 'initiated',
      });
      mockStore.findLatestPaymentByOrderId.mockResolvedValue({
        id: 'active-payment',
        status: 'processing',
      });

      await expect(
        service.initiatePayment(
          MOCK_USER_ID,
          MOCK_ORDER_ID,
          'http://localhost:3000',
        ),
      ).rejects.toThrow(InvalidOperationError);
    });

    it('throws InvalidOperationError for unsupported payment method', async () => {
      mockStore.findOrderById.mockResolvedValue(mockPendingOrder);

      await expect(
        service.initiatePayment(
          MOCK_USER_ID,
          MOCK_ORDER_ID,
          'http://localhost:3000',
          'crypto_bitcoin',
        ),
      ).rejects.toThrow(InvalidOperationError);
    });

    it('delegates to initiateCod when requestedMethod is cod', async () => {
      mockStore.findOrderById.mockResolvedValue(mockPendingOrder);
      mockStore.createPayment.mockResolvedValue(mockPayment);

      const result = await service.initiatePayment(
        MOCK_USER_ID,
        MOCK_ORDER_ID,
        'http://localhost:3000',
        'cod',
      );

      expect(result).toEqual({ payment: mockPayment });
    });

    it('throws EntityNotFoundError when user record is missing', async () => {
      mockStore.findOrderById.mockResolvedValue(mockPendingOrder);
      mockStore.findUserById.mockResolvedValue(null);

      await expect(
        service.initiatePayment(
          MOCK_USER_ID,
          MOCK_ORDER_ID,
          'http://localhost:3000',
          'sslcommerz',
        ),
      ).rejects.toThrow(EntityNotFoundError);
    });

    it('initiates SSLCommerz payment and returns gatewayUrl on SUCCESS', async () => {
      mockStore.findOrderById.mockResolvedValue(mockPendingOrder);
      mockStore.findUserById.mockResolvedValue(mockUser);
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            status: 'SUCCESS',
            GatewayPageURL: 'https://sandbox.sslcommerz.com/gateway/pay',
          }),
      });

      const result = await service.initiatePayment(
        MOCK_USER_ID,
        MOCK_ORDER_ID,
        'http://localhost:3000',
        'sslcommerz',
      );

      expect(mockStore.createPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: MOCK_ORDER_ID,
          amount: '500.00',
          method: 'SSLCommerz',
          status: 'pending',
        }),
        expect.anything(),
      );
      expect(mockStore.updateOrderStatus).toHaveBeenCalledWith(
        MOCK_ORDER_ID,
        { paymentStatus: 'initiated' },
        expect.anything(),
      );
      expect(result).toEqual({
        gatewayUrl: 'https://sandbox.sslcommerz.com/gateway/pay',
      });
    });

    it('throws InvalidOperationError when gateway responds with non-SUCCESS status', async () => {
      mockStore.findOrderById.mockResolvedValue(mockPendingOrder);
      mockStore.findUserById.mockResolvedValue(mockUser);
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            status: 'FAILED',
            failedreason: 'Invalid Credentials',
          }),
      });

      await expect(
        service.initiatePayment(
          MOCK_USER_ID,
          MOCK_ORDER_ID,
          'http://localhost:3000',
        ),
      ).rejects.toThrow('Could not connect to payment gateway');
    });

    it('throws InvalidOperationError when network call to gateway fails', async () => {
      mockStore.findOrderById.mockResolvedValue(mockPendingOrder);
      mockStore.findUserById.mockResolvedValue(mockUser);
      (global.fetch as jest.Mock).mockRejectedValueOnce(
        new Error('Network timeout'),
      );

      await expect(
        service.initiatePayment(
          MOCK_USER_ID,
          MOCK_ORDER_ID,
          'http://localhost:3000',
        ),
      ).rejects.toThrow('Could not connect to payment gateway');
    });
  });

  // ── verifyPayment & IPN validation ──────────────────────────────────────────

  describe('verifyPayment & handleSuccessfulPayment', () => {
    it('rejects IPN unconditionally if verify_sign or verify_key is missing without val_id', async () => {
      const result = await service.verifyPayment({
        tran_id: 'tran-001',
        status: 'VALID',
        // missing verify_sign and verify_key and val_id
      });
      expect(result).toMatchObject({
        success: false,
        message: 'Invalid IPN signature',
      });
    });

    it('rejects IPN unconditionally if verify_sign is invalid and no val_id', async () => {
      const result = await service.verifyPayment({
        tran_id: 'tran-001',
        status: 'VALID',
        verify_key: 'tran_id',
        verify_sign: 'WRONG_SIGNATURE_HASH',
      });
      expect(result).toMatchObject({
        success: false,
        message: 'Invalid IPN signature',
      });
    });

    it('validates IPN with valid SHA256 signature (verify_sign_sha2)', async () => {
      const ipnData = {
        val_id: 'v-sha2',
        tran_id: MOCK_TRAN_ID,
        status: 'VALID',
        amount: '500.00',
        verify_key: 'tran_id,amount',
      };
      const signedIpn = {
        ...ipnData,
        verify_sign_sha2: generateValidSha256Signature(ipnData),
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        json: () => Promise.resolve({ status: 'VALIDATED', amount: '500.00' }),
      });
      mockStore.findPaymentByTransactionId.mockResolvedValue(mockPayment);

      const result = await service.verifyPayment(signedIpn);

      expect(result).toMatchObject({
        success: true,
        message: 'Payment verified and order is now processing',
      });
      expect(mockStore.updatePaymentStatus).toHaveBeenCalledWith(
        mockPayment.id,
        expect.objectContaining({ status: 'completed' }),
        expect.anything(),
      );
      expect(mockStore.updateOrderStatus).toHaveBeenCalledWith(
        mockPayment.orderId,
        { status: 'processing', paymentStatus: 'paid' },
        expect.anything(),
      );
    });

    it('returns success: false if payment amount does not match IPN amount', async () => {
      const ipnData = {
        val_id: 'v1',
        tran_id: MOCK_TRAN_ID,
        status: 'VALID',
        amount: '100.00',
        verify_key: 'tran_id,amount',
      };
      const signedIpn = {
        ...ipnData,
        verify_sign: generateValidMd5Signature(ipnData),
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        json: () => Promise.resolve({ status: 'VALIDATED', amount: '100.00' }),
      });
      mockStore.findPaymentByTransactionId.mockResolvedValue({
        ...mockPayment,
        amount: '500.00',
      });

      const result = await service.verifyPayment(signedIpn);

      expect(result).toMatchObject({
        success: false,
        message:
          'Payment amount mismatch — transaction rejected for security review',
      });
    });

    it('processes successful payment when signature and amount both match', async () => {
      const ipnData = {
        val_id: 'v1',
        tran_id: MOCK_TRAN_ID,
        status: 'VALID',
        amount: '500.00',
        verify_key: 'tran_id,amount',
      };
      const signedIpn = {
        ...ipnData,
        verify_sign: generateValidMd5Signature(ipnData),
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        json: () => Promise.resolve({ status: 'VALIDATED', amount: '500.00' }),
      });
      mockStore.findPaymentByTransactionId.mockResolvedValue(mockPayment);

      const result = await service.verifyPayment(signedIpn);

      expect(result).toMatchObject({
        success: true,
        message: 'Payment verified and order is now processing',
      });
      expect(mockStore.updatePaymentStatus).toHaveBeenCalledWith(
        mockPayment.id,
        expect.objectContaining({ status: 'completed' }),
        expect.anything(),
      );
      expect(mockStore.updateOrderStatus).toHaveBeenCalledWith(
        mockPayment.orderId,
        { status: 'processing', paymentStatus: 'paid' },
        expect.anything(),
      );
    });

    it('records payment as paid but does not revive cancelled order when order was already cancelled', async () => {
      const ipnData = {
        val_id: 'v1',
        tran_id: MOCK_TRAN_ID,
        status: 'VALID',
        amount: '500.00',
        verify_key: 'tran_id,amount',
      };
      const signedIpn = {
        ...ipnData,
        verify_sign: generateValidMd5Signature(ipnData),
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        json: () => Promise.resolve({ status: 'VALIDATED', amount: '500.00' }),
      });
      mockStore.findPaymentByTransactionId.mockResolvedValue(mockPayment);
      mockStore.findOrderByIdForUpdate.mockResolvedValue({
        id: mockPayment.orderId,
        status: 'cancelled',
      });

      const result = await service.verifyPayment(signedIpn);

      expect(result.success).toBe(true);
      expect(mockStore.updatePaymentStatus).toHaveBeenCalledWith(
        mockPayment.id,
        expect.objectContaining({ status: 'completed' }),
        expect.anything(),
      );
      expect(mockStore.updateOrderStatus).toHaveBeenCalledWith(
        mockPayment.orderId,
        { paymentStatus: 'paid' },
        expect.anything(),
      );
    });

    it('safely handles duplicate IPN for already completed payment (idempotent)', async () => {
      const ipnData = {
        val_id: 'v1',
        tran_id: MOCK_TRAN_ID,
        status: 'VALID',
        amount: '500.00',
        verify_key: 'tran_id,amount',
      };
      const signedIpn = {
        ...ipnData,
        verify_sign: generateValidMd5Signature(ipnData),
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        json: () => Promise.resolve({ status: 'VALIDATED', amount: '500.00' }),
      });
      mockStore.findPaymentByTransactionId.mockResolvedValue({
        ...mockPayment,
        status: 'completed',
      });

      const result = await service.verifyPayment(signedIpn);

      expect(result).toMatchObject({
        success: true,
        message: 'Payment already processed (duplicate IPN ignored)',
      });
      expect(mockStore.updatePaymentStatus).not.toHaveBeenCalled();
    });

    it('handles failed payment when validation API returns status other than VALID/VALIDATED', async () => {
      const ipnData = {
        val_id: 'v1',
        tran_id: MOCK_TRAN_ID,
        status: 'VALID',
        verify_key: 'tran_id',
      };
      const signedIpn = {
        ...ipnData,
        verify_sign: generateValidMd5Signature(ipnData),
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        json: () => Promise.resolve({ status: 'FAILED' }),
      });
      mockStore.findPaymentByTransactionId.mockResolvedValue(mockPayment);

      const result = await service.verifyPayment(signedIpn);

      expect(result).toMatchObject({
        success: false,
        message: 'Payment failed or cancelled',
      });
      expect(mockStore.updatePaymentStatus).toHaveBeenCalledWith(
        mockPayment.id,
        expect.objectContaining({ status: 'failed' }),
        expect.anything(),
      );
      expect(mockStore.updateOrderStatus).toHaveBeenCalledWith(
        mockPayment.orderId,
        { paymentStatus: 'unpaid' },
        expect.anything(),
      );
    });

    it('handles failed IPN directly when status is FAILED without calling validator API', async () => {
      const ipnData = {
        tran_id: MOCK_TRAN_ID,
        status: 'FAILED',
        verify_key: 'tran_id',
      };
      const signedIpn = {
        ...ipnData,
        verify_sign: generateValidMd5Signature(ipnData),
      };

      mockStore.findPaymentByTransactionId.mockResolvedValue(mockPayment);

      const result = await service.verifyPayment(signedIpn);

      expect(global.fetch).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        success: false,
        message: 'Payment failed or cancelled',
      });
      expect(mockStore.updatePaymentStatus).toHaveBeenCalledWith(
        mockPayment.id,
        expect.objectContaining({ status: 'failed' }),
        expect.anything(),
      );
    });
  });

  // ── handleCancelCallback ────────────────────────────────────────────────────

  describe('handleCancelCallback', () => {
    it('cancels payment via tran_id when provided', async () => {
      mockStore.findPaymentByTransactionId.mockResolvedValue(mockPayment);

      await service.handleCancelCallback({ tran_id: MOCK_TRAN_ID });

      expect(mockStore.updatePaymentStatus).toHaveBeenCalledWith(
        mockPayment.id,
        expect.objectContaining({ status: 'failed' }),
        expect.anything(),
      );
      expect(mockStore.updateOrderStatus).toHaveBeenCalledWith(
        mockPayment.orderId,
        { paymentStatus: 'unpaid' },
        expect.anything(),
      );
    });

    it('cancels payment via value_a (orderId fallback) when tran_id is missing', async () => {
      mockStore.findLatestPendingPaymentByOrderId.mockResolvedValue(
        mockPayment,
      );

      await service.handleCancelCallback({ value_a: MOCK_ORDER_ID });

      expect(mockStore.findLatestPendingPaymentByOrderId).toHaveBeenCalledWith(
        MOCK_ORDER_ID,
      );
      expect(mockStore.updatePaymentStatus).toHaveBeenCalledWith(
        mockPayment.id,
        expect.objectContaining({ status: 'failed' }),
        expect.anything(),
      );
      expect(mockStore.updateOrderStatus).toHaveBeenCalledWith(
        MOCK_ORDER_ID,
        { paymentStatus: 'unpaid' },
        expect.anything(),
      );
    });

    it('gracefully exits when neither tran_id nor value_a is provided', async () => {
      await service.handleCancelCallback({});

      expect(mockStore.findPaymentByTransactionId).not.toHaveBeenCalled();
      expect(mockStore.updatePaymentStatus).not.toHaveBeenCalled();
    });
  });

  describe('handleFailCallback', () => {
    it('marks payment failed and order unpaid via tran_id', async () => {
      mockStore.findPaymentByTransactionId.mockResolvedValue(mockPayment);

      await service.handleFailCallback({
        tran_id: MOCK_TRAN_ID,
        status: 'FAILED',
      });

      expect(mockStore.updatePaymentStatus).toHaveBeenCalledWith(
        mockPayment.id,
        expect.objectContaining({ status: 'failed' }),
        expect.anything(),
      );
      expect(mockStore.updateOrderStatus).toHaveBeenCalledWith(
        mockPayment.orderId,
        { paymentStatus: 'unpaid' },
        expect.anything(),
      );
    });

    it('marks pending payment failed via value_a when tran_id is missing', async () => {
      mockStore.findLatestPendingPaymentByOrderId.mockResolvedValue(
        mockPayment,
      );

      await service.handleFailCallback({ value_a: MOCK_ORDER_ID });

      expect(mockStore.updatePaymentStatus).toHaveBeenCalledWith(
        mockPayment.id,
        expect.objectContaining({ status: 'failed' }),
        expect.anything(),
      );
      expect(mockStore.updateOrderStatus).toHaveBeenCalledWith(
        MOCK_ORDER_ID,
        { paymentStatus: 'unpaid' },
        expect.anything(),
      );
    });

    it('gracefully exits when neither tran_id nor value_a is provided', async () => {
      await service.handleFailCallback({});

      expect(mockStore.findPaymentByTransactionId).not.toHaveBeenCalled();
      expect(mockStore.updatePaymentStatus).not.toHaveBeenCalled();
    });
  });

  describe('Security & Gateway Edge Cases', () => {
    it('rejects initiation if active pending payment was created < 2 minutes ago', async () => {
      mockStore.findOrderById.mockResolvedValue({
        ...mockPendingOrder,
        paymentStatus: 'initiated',
      });
      mockStore.findLatestPaymentByOrderId.mockResolvedValue({
        id: 'recent-payment',
        status: 'pending',
        createdAt: new Date(), // Just created
      });

      await expect(
        service.initiatePayment(
          MOCK_USER_ID,
          MOCK_ORDER_ID,
          'http://localhost:3000',
        ),
      ).rejects.toThrow(
        'A payment session is currently in progress for this order',
      );
    });

    it('rejects IPN when currency is not BDT', async () => {
      const ipnData = {
        val_id: 'v-usd',
        tran_id: MOCK_TRAN_ID,
        status: 'VALID',
        amount: '500.00',
        verify_key: 'tran_id,amount',
      };
      const signedIpn = {
        ...ipnData,
        verify_sign_sha2: generateValidSha256Signature(ipnData),
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            status: 'VALID',
            amount: '500.00',
            currency: 'USD',
            tran_id: MOCK_TRAN_ID,
          }),
      });
      mockStore.findPaymentByTransactionId.mockResolvedValue(mockPayment);

      const result = await service.verifyPayment(signedIpn);

      expect(result).toMatchObject({
        success: false,
        message:
          'Payment currency mismatch — transaction rejected for security review',
      });
    });

    it('rejects IPN when validator tran_id does not match payment tran_id', async () => {
      const ipnData = {
        val_id: 'v-mismatch',
        tran_id: MOCK_TRAN_ID,
        status: 'VALID',
        amount: '500.00',
        verify_key: 'tran_id,amount',
      };
      const signedIpn = {
        ...ipnData,
        verify_sign_sha2: generateValidSha256Signature(ipnData),
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            status: 'VALID',
            amount: '500.00',
            currency: 'BDT',
            tran_id: 'TRN_SPOOFED_ID',
          }),
      });
      mockStore.findPaymentByTransactionId.mockResolvedValue(mockPayment);

      const result = await service.verifyPayment(signedIpn);

      expect(result).toMatchObject({
        success: false,
        message: 'Transaction ID mismatch — callback rejected',
      });
    });

    it('rejects IPN when validator value_a does not match order ID', async () => {
      const ipnData = {
        val_id: 'v-ord-mismatch',
        tran_id: MOCK_TRAN_ID,
        status: 'VALID',
        amount: '500.00',
        verify_key: 'tran_id,amount',
      };
      const signedIpn = {
        ...ipnData,
        verify_sign_sha2: generateValidSha256Signature(ipnData),
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            status: 'VALID',
            amount: '500.00',
            currency: 'BDT',
            tran_id: MOCK_TRAN_ID,
            value_a: 'different-order-uuid',
          }),
      });
      mockStore.findPaymentByTransactionId.mockResolvedValue(mockPayment);

      const result = await service.verifyPayment(signedIpn);

      expect(result).toMatchObject({
        success: false,
        message: 'Order ID mismatch — callback rejected',
      });
    });

    it('cleans up pending payment when gateway returns non-SUCCESS init status', async () => {
      mockStore.findOrderById.mockResolvedValue(mockPendingOrder);
      mockStore.findUserById.mockResolvedValue(mockUser);
      mockStore.createPayment.mockResolvedValue(mockPayment);
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            status: 'FAILED',
            failedreason: 'Invalid Store ID',
          }),
      });

      await expect(
        service.initiatePayment(
          MOCK_USER_ID,
          MOCK_ORDER_ID,
          'http://localhost:3000',
        ),
      ).rejects.toThrow('Could not connect to payment gateway');

      expect(mockStore.updatePaymentStatus).toHaveBeenCalledWith(
        mockPayment.id,
        expect.objectContaining({ status: 'failed' }),
        expect.anything(),
      );
      expect(mockStore.updateOrderStatus).toHaveBeenCalledWith(
        MOCK_ORDER_ID,
        { paymentStatus: 'unpaid' },
        expect.anything(),
      );
    });
  });
});
