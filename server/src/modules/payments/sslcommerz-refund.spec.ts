import { Test, TestingModule } from '@nestjs/testing';
import { PaymentsService } from './payments.service';
import { PaymentsStore } from './payments.store';
import { ConfigService } from '@nestjs/config';
import {
  EntityNotFoundError,
  InvalidOperationError,
} from '../../common/errors/domain.errors';

describe('SSLCommerz Refund Protocol & Integration (REF-22-A to REF-22-J)', () => {
  let service: PaymentsService;
  let mockPaymentsStore: any;
  let mockConfigService: any;
  let originalFetch: typeof global.fetch;

  beforeAll(() => {
    originalFetch = global.fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  beforeEach(async () => {
    mockPaymentsStore = {
      findPaymentById: jest.fn(),
      findPaymentByIdForUpdate: jest.fn(),
      runTransaction: jest.fn(async (cb) => await cb({})),
    };

    mockConfigService = {
      get: jest.fn((key: string) => {
        if (key === 'SSLCOMMERZ_STORE_ID') return 'testbox';
        if (key === 'SSLCOMMERZ_STORE_SECRET') return 'testpass';
        if (key === 'SSLCOMMERZ_IS_SANDBOX') return 'true';
        return undefined;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PaymentsStore, useValue: mockPaymentsStore },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
  });

  describe('initiateRefund', () => {
    const paymentId = 'pay-uuid-1';
    const refundId = 'ref-uuid-1';

    it('REF-22-A: Valid provider-confirmed refund returns success with refundRefId', async () => {
      mockPaymentsStore.findPaymentById.mockResolvedValue({
        id: paymentId,
        amount: '1200.00',
        status: 'completed',
        method: 'SSLCommerz',
        transactionId: 'TRN-12345',
        gatewayResponse: {
          bank_tran_id: 'BANK-TRN-999',
          val_id: 'VAL-123',
        },
      });

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          APIConnect: 'DONE',
          status: 'success',
          refund_ref_id: 'SSL-REF-777',
          bank_tran_id: 'BANK-TRN-999',
          trans_id: 'TRN-12345',
        }),
      } as any);

      const result = await service.initiateRefund({
        paymentId,
        amount: 1200.0,
        reason: 'Customer return',
        refundId,
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('initiated');
      expect(result.refundRefId).toBe('SSL-REF-777');
    });

    it('REF-22-B: Provider rejects refund request returns status failed with errorReason', async () => {
      mockPaymentsStore.findPaymentById.mockResolvedValue({
        id: paymentId,
        amount: '1200.00',
        status: 'completed',
        method: 'SSLCommerz',
        transactionId: 'TRN-12345',
        gatewayResponse: { bank_tran_id: 'BANK-TRN-999' },
      });

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          APIConnect: 'DONE',
          status: 'failed',
          errorReason: 'Already Refunded or Invalid Transaction ID',
        }),
      } as any);

      const result = await service.initiateRefund({
        paymentId,
        amount: 500.0,
        reason: 'Duplicate request',
        refundId,
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('failed');
      expect(result.errorReason).toContain('Already Refunded');
    });

    it('REF-22-C: Provider times out before response -> marked processing, not failed, for safe reconciliation', async () => {
      mockPaymentsStore.findPaymentById.mockResolvedValue({
        id: paymentId,
        amount: '1200.00',
        status: 'completed',
        method: 'SSLCommerz',
        transactionId: 'TRN-12345',
        gatewayResponse: { bank_tran_id: 'BANK-TRN-999' },
      });

      // Simulate timeout
      global.fetch = jest
        .fn()
        .mockRejectedValue(
          new Error('The operation was aborted due to timeout'),
        );

      const result = await service.initiateRefund({
        paymentId,
        amount: 1200.0,
        reason: 'Timeout test',
        refundId,
      });

      // Crucial invariant: Do NOT mark failed on timeout!
      expect(result.status).toBe('processing');
      expect(result.errorReason).toContain('timeout');
    });

    it('REF-22-D / REF-22-E: HTTP response lost / 502 Bad Gateway -> marked processing for inquiry reconciliation', async () => {
      mockPaymentsStore.findPaymentById.mockResolvedValue({
        id: paymentId,
        amount: '1000.00',
        status: 'completed',
        method: 'SSLCommerz',
        transactionId: 'TRN-12345',
        gatewayResponse: { bank_tran_id: 'BANK-TRN-999' },
      });

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
      } as any);

      const result = await service.initiateRefund({
        paymentId,
        amount: 1000.0,
        reason: 'Gateway hiccup',
        refundId,
      });

      expect(result.status).toBe('processing');
      expect(result.errorReason).toContain('502');
    });

    it('REF-22-I: Rejects refund exceeding captured payment amount', async () => {
      mockPaymentsStore.findPaymentById.mockResolvedValue({
        id: paymentId,
        amount: '500.00',
        status: 'completed',
        method: 'SSLCommerz',
      });

      await expect(
        service.initiateRefund({
          paymentId,
          amount: 600.0,
          reason: 'Excessive refund',
          refundId,
        }),
      ).rejects.toThrow('cannot exceed captured payment amount');
    });

    it('REF-22-J: Rejects refund for non-completed or pending payment', async () => {
      mockPaymentsStore.findPaymentById.mockResolvedValue({
        id: paymentId,
        amount: '500.00',
        status: 'pending',
        method: 'SSLCommerz',
      });

      await expect(
        service.initiateRefund({
          paymentId,
          amount: 500.0,
          reason: 'Premature refund',
          refundId,
        }),
      ).rejects.toThrow('Only completed payments can be refunded');
    });

    it('Never calls SSLCommerz refund API for Cash on Delivery (COD) payments', async () => {
      mockPaymentsStore.findPaymentById.mockResolvedValue({
        id: paymentId,
        amount: '750.00',
        status: 'completed',
        method: 'COD',
      });

      const fetchSpy = jest.fn();
      global.fetch = fetchSpy;

      const result = await service.initiateRefund({
        paymentId,
        amount: 750.0,
        reason: 'COD return',
        refundId,
      });

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.status).toBe('initiated');
      expect(result.refundRefId).toContain('COD-REFUND');
    });
  });

  describe('queryRefundStatus (Inquiry API Contract - REF-G02 to REF-G08)', () => {
    const refundRefId = 'SSL-REF-777';
    const bankTranId = 'BANK-TRN-999';
    const tranId = 'TRN-12345';

    it('REF-G02 / REF-22-G: Refund inquiry reports pending -> returns status processing', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          APIConnect: 'DONE',
          status: 'processing',
          refund_ref_id: refundRefId,
          bank_tran_id: bankTranId,
        }),
      } as any);

      const result = await service.queryRefundStatus(refundRefId);

      expect(result.success).toBe(true);
      expect(result.status).toBe('processing');
      expect(result.refundRefId).toBe(refundRefId);
    });

    it('REF-G03 / REF-22-H: Refund inquiry confirms settlement (status: refunded) -> returns status refunded with evidence', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          APIConnect: 'DONE',
          status: 'refunded',
          refund_ref_id: refundRefId,
          bank_tran_id: bankTranId,
          tran_id: tranId,
          initiated_on: '2026-10-21 10:00:00',
          refunded_on: '2026-10-21 11:30:00',
        }),
      } as any);

      const result = await service.queryRefundStatus(refundRefId, {
        expectedBankTranId: bankTranId,
        expectedTranId: tranId,
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('refunded');
      expect(result.bankTranId).toBe(bankTranId);
      expect(result.tranId).toBe(tranId);
      expect(result.refundedOn).toBe('2026-10-21 11:30:00');
    });

    it("REF-G04: Refund inquiry returns status 'success' -> treated as unknown_status, NOT final settlement", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          APIConnect: 'DONE',
          status: 'success', // Initiation-style status returned unexpectedly on inquiry
          refund_ref_id: refundRefId,
          bank_tran_id: bankTranId,
        }),
      } as any);

      const result = await service.queryRefundStatus(refundRefId);

      expect(result.success).toBe(false);
      expect(result.status).toBe('unknown_status');
      expect(result.errorReason).toContain("Unexpected 'success' status");
    });

    it('REF-G05: Provider returns incorrect refund reference -> invalid_identity, no finalization', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          APIConnect: 'DONE',
          status: 'refunded',
          refund_ref_id: 'MISMATCHED-REF-999',
          bank_tran_id: bankTranId,
        }),
      } as any);

      const result = await service.queryRefundStatus(refundRefId);

      expect(result.success).toBe(false);
      expect(result.status).toBe('invalid_identity');
      expect(result.errorReason).toContain('mismatched refund_ref_id');
    });

    it('REF-G06: Provider returns incorrect original transaction identity -> invalid_identity, no finalization', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          APIConnect: 'DONE',
          status: 'refunded',
          refund_ref_id: refundRefId,
          bank_tran_id: 'FOREIGN-BANK-ID',
          tran_id: tranId,
        }),
      } as any);

      const result = await service.queryRefundStatus(refundRefId, {
        expectedBankTranId: bankTranId,
        expectedTranId: tranId,
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('invalid_identity');
      expect(result.errorReason).toContain('mismatched bank_tran_id');
    });

    it('REF-G07: Provider authentication fails or APIConnect is not DONE -> failed_auth', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          APIConnect: 'FAILED',
          status: 'failed',
          errorReason: 'Invalid store password credentials',
        }),
      } as any);

      const result = await service.queryRefundStatus(refundRefId);

      expect(result.success).toBe(false);
      expect(result.status).toBe('failed_auth');
      expect(result.errorReason).toContain('APIConnect=FAILED');
    });

    it('REF-G08: Gateway returns unknown or malformed status -> safe unknown_status state', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          APIConnect: 'DONE',
          status: 'corrupted_state',
          refund_ref_id: refundRefId,
        }),
      } as any);

      const result = await service.queryRefundStatus(refundRefId);

      expect(result.success).toBe(false);
      expect(result.status).toBe('unknown_status');
      expect(result.errorReason).toContain('Unknown or malformed');
    });

    it('Provider returns cancelled status -> returns status cancelled', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          APIConnect: 'DONE',
          status: 'cancelled',
          refund_ref_id: refundRefId,
          errorReason: 'Customer card revoked by issuing bank',
        }),
      } as any);

      const result = await service.queryRefundStatus(refundRefId);

      expect(result.success).toBe(false);
      expect(result.status).toBe('cancelled');
      expect(result.errorReason).toContain('Customer card revoked');
    });
  });
});
