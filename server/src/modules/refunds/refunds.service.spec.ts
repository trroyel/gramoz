import { Test, TestingModule } from '@nestjs/testing';
import { RefundsService } from './refunds.service';
import { RefundsStore } from './refunds.store';
import { PaymentsService } from '../payments/payments.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import {
  EntityNotFoundError,
  InvalidOperationError,
  ForbiddenOperationError,
} from '../../common/errors/domain.errors';

describe('RefundsService (Unit Tests)', () => {
  let service: RefundsService;
  let mockRefundsStore: any;
  let mockPaymentsService: any;
  let mockLoyaltyService: any;

  beforeEach(async () => {
    mockRefundsStore = {
      runTransaction: jest.fn(async (cb) => await cb({})),
      findOrderById: jest.fn(),
      findOrderByIdForUpdate: jest.fn(),
      updateOrderStatus: jest.fn(),
      findRefundById: jest.fn(),
      findRefundByIdForUpdate: jest.fn(),
      findRefundByOrderId: jest.fn(),
      findActiveRefundByOrderId: jest.fn(),
      findRefundByOrderIdForUpdate: jest.fn(),
      createRefund: jest.fn(),
      updateRefund: jest.fn(),
      findPaymentById: jest.fn(),
      findPaymentByIdForUpdate: jest.fn(),
      findCompletedPaymentByOrderId: jest.fn(),
      updatePaymentStatus: jest.fn(),
      getOrderItems: jest.fn(),
      findVariantById: jest.fn(),
      restockVariant: jest.fn(),
      restockProduct: jest.fn(),
      createInventoryTransaction: jest.fn(),
      hasOrderBeenRestocked: jest.fn(),
      hasRefundBeenRestocked: jest.fn(),
      getPointsSpentOnOrder: jest.fn(),
      hasPointsBeenRefunded: jest.fn(),
      getAllRefunds: jest.fn(),
      getMyRefunds: jest.fn(),
    };

    mockPaymentsService = {
      initiateRefund: jest.fn(),
      queryRefundStatus: jest.fn(),
    };

    mockLoyaltyService = {
      refundPoints: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RefundsService,
        { provide: RefundsStore, useValue: mockRefundsStore },
        { provide: PaymentsService, useValue: mockPaymentsService },
        { provide: LoyaltyService, useValue: mockLoyaltyService },
      ],
    }).compile();

    service = module.get<RefundsService>(RefundsService);
  });

  describe('requestRefund', () => {
    const userId = 'user-123';
    const validDto = {
      orderId: 'order-123',
      amount: 150.0,
      reason: 'wrong_item' as const,
      notes: 'Received wrong size',
    };

    it('rejects if amount is <= 0 or not a number', async () => {
      await expect(
        service.requestRefund(userId, { ...validDto, amount: 0 }),
      ).rejects.toThrow(InvalidOperationError);

      await expect(
        service.requestRefund(userId, { ...validDto, amount: -10 }),
      ).rejects.toThrow(InvalidOperationError);

      await expect(
        service.requestRefund(userId, { ...validDto, amount: NaN }),
      ).rejects.toThrow(InvalidOperationError);
    });

    it('rejects if order is not found', async () => {
      mockRefundsStore.findOrderById.mockResolvedValue(null);

      await expect(service.requestRefund(userId, validDto)).rejects.toThrow(
        EntityNotFoundError,
      );
    });

    it('rejects if order belongs to a different user', async () => {
      mockRefundsStore.findOrderById.mockResolvedValue({
        id: 'order-123',
        userId: 'different-user',
        status: 'delivered',
        totalAmount: '200.00',
      });

      await expect(service.requestRefund(userId, validDto)).rejects.toThrow(
        ForbiddenOperationError,
      );
    });

    it('rejects if order is not delivered', async () => {
      mockRefundsStore.findOrderById.mockResolvedValue({
        id: 'order-123',
        userId,
        status: 'processing',
        totalAmount: '200.00',
      });

      await expect(service.requestRefund(userId, validDto)).rejects.toThrow(
        InvalidOperationError,
      );
    });

    it('rejects if refund already requested for order', async () => {
      mockRefundsStore.findOrderById.mockResolvedValue({
        id: 'order-123',
        userId,
        status: 'delivered',
        totalAmount: '200.00',
      });
      mockRefundsStore.findActiveRefundByOrderId.mockResolvedValue({
        id: 'ref-existing',
        status: 'requested',
      });

      await expect(service.requestRefund(userId, validDto)).rejects.toThrow(
        'A refund request already exists for this order',
      );
    });

    it('rejects if refund amount exceeds order total', async () => {
      mockRefundsStore.findOrderById.mockResolvedValue({
        id: 'order-123',
        userId,
        status: 'delivered',
        totalAmount: '100.00',
      });
      mockRefundsStore.findRefundByOrderId.mockResolvedValue(null);

      await expect(service.requestRefund(userId, validDto)).rejects.toThrow(
        'cannot exceed order total',
      );
    });

    it('creates refund with authoritative paymentId ignoring client paymentId tampering', async () => {
      mockRefundsStore.findOrderById.mockResolvedValue({
        id: 'order-123',
        userId,
        status: 'delivered',
        totalAmount: '200.00',
      });
      mockRefundsStore.findRefundByOrderId.mockResolvedValue(null);
      mockRefundsStore.findCompletedPaymentByOrderId.mockResolvedValue({
        id: 'authoritative-pay-id',
      });
      mockRefundsStore.createRefund.mockResolvedValue({
        id: 'ref-new',
        orderId: 'order-123',
        paymentId: 'authoritative-pay-id',
        amount: '150.00',
        status: 'requested',
      });

      const result = await service.requestRefund(userId, {
        ...validDto,
        paymentId: 'tampered-pay-id',
      });

      expect(mockRefundsStore.createRefund).toHaveBeenCalledWith(
        expect.objectContaining({
          paymentId: 'authoritative-pay-id',
          amount: '150.00',
          status: 'requested',
        }),
      );
      expect(result.id).toBe('ref-new');
    });

    it('handles unique constraint violation gracefully on concurrency race', async () => {
      mockRefundsStore.findOrderById.mockResolvedValue({
        id: 'order-123',
        userId,
        status: 'delivered',
        totalAmount: '200.00',
      });
      mockRefundsStore.findRefundByOrderId.mockResolvedValue(null);
      mockRefundsStore.findActiveRefundByOrderId.mockResolvedValue(null);
      mockRefundsStore.findCompletedPaymentByOrderId.mockResolvedValue(null);
      mockRefundsStore.createRefund.mockRejectedValue({
        code: '23505',
        message:
          'duplicate key value violates unique constraint "uq_refunds_order_id"',
      });

      await expect(service.requestRefund(userId, validDto)).rejects.toThrow(
        'A refund request already exists for this order',
      );
    });
  });

  describe('processRefund', () => {
    const adminId = 'admin-uuid';
    const refundId = 'ref-123';

    it('rejects if refund record is not found', async () => {
      mockRefundsStore.findRefundById.mockResolvedValue(null);

      await expect(
        service.processRefund(adminId, refundId, { status: 'rejected' }),
      ).rejects.toThrow(EntityNotFoundError);
    });

    it('rejects if refund has already been processed or rejected', async () => {
      mockRefundsStore.findRefundById.mockResolvedValue({
        id: refundId,
        status: 'processed',
      });

      await expect(
        service.processRefund(adminId, refundId, { status: 'processed' }),
      ).rejects.toThrow('Refund request has already been processed');
    });

    it('approves a refund successfully without touching inventory or payments', async () => {
      mockRefundsStore.findRefundById.mockResolvedValue({
        id: refundId,
        orderId: 'order-1',
        status: 'requested',
      });
      mockRefundsStore.findOrderByIdForUpdate.mockResolvedValue({
        id: 'order-1',
      });
      mockRefundsStore.findRefundByIdForUpdate.mockResolvedValue({
        id: refundId,
        status: 'requested',
      });
      mockRefundsStore.updateRefund.mockResolvedValue({
        id: refundId,
        status: 'approved',
      });

      const result = await service.processRefund(adminId, refundId, {
        status: 'approved',
        adminNotes: 'Eligible for return',
      });

      expect(result.status).toBe('approved');
      expect(mockRefundsStore.updatePaymentStatus).not.toHaveBeenCalled();
      expect(mockRefundsStore.restockProduct).not.toHaveBeenCalled();
    });

    it('rejects a refund successfully', async () => {
      mockRefundsStore.findRefundById.mockResolvedValue({
        id: refundId,
        orderId: 'order-1',
        status: 'requested',
      });
      mockRefundsStore.findOrderByIdForUpdate.mockResolvedValue({
        id: 'order-1',
      });
      mockRefundsStore.findRefundByIdForUpdate.mockResolvedValue({
        id: refundId,
        status: 'requested',
      });
      mockRefundsStore.updateRefund.mockResolvedValue({
        id: refundId,
        status: 'rejected',
      });

      const result = await service.processRefund(adminId, refundId, {
        status: 'rejected',
        adminNotes: 'Return window expired',
      });

      expect(result.status).toBe('rejected');
    });

    it('REF-G01: Online refund initiation marks processing and captures gateway reference without premature finalization', async () => {
      mockRefundsStore.findRefundById.mockResolvedValue({
        id: refundId,
        orderId: 'order-1',
        paymentId: 'pay-online-1',
        amount: '500.00',
        reason: 'wrong_item',
        status: 'requested',
      });
      mockRefundsStore.findPaymentById.mockResolvedValue({
        id: 'pay-online-1',
        status: 'completed',
        method: 'SSLCommerz',
      });
      mockPaymentsService.initiateRefund.mockResolvedValue({
        success: true,
        status: 'initiated',
        refundRefId: 'SSL-REF-999',
      });
      mockRefundsStore.findRefundByIdForUpdate.mockResolvedValue({
        id: refundId,
        status: 'requested',
      });
      mockRefundsStore.updateRefund.mockResolvedValue({
        id: refundId,
        status: 'processing',
        gatewayRefundId: 'SSL-REF-999',
      });

      const result = await service.processRefund(adminId, refundId, {
        status: 'processed',
      });

      // Verify provider was invoked
      expect(mockPaymentsService.initiateRefund).toHaveBeenCalled();
      // INVARIANT: Final settlement is NOT prematurely finalized solely from initiation!
      expect(mockRefundsStore.updatePaymentStatus).not.toHaveBeenCalled();
      expect(mockRefundsStore.updateOrderStatus).not.toHaveBeenCalled();
      expect(mockRefundsStore.restockVariant).not.toHaveBeenCalled();
      expect(mockLoyaltyService.refundPoints).not.toHaveBeenCalled();
      // Refund remains in 'processing' with gatewayRefundId persisted
      expect(result.status).toBe('processing');
      expect(mockRefundsStore.updateRefund).toHaveBeenCalledWith(
        refundId,
        expect.objectContaining({
          status: 'processing',
          gatewayRefundId: 'SSL-REF-999',
        }),
      );
    });

    it('processes a COD refund with local settlement acknowledgment, restocks saleable items, and refunds loyalty points', async () => {
      mockRefundsStore.findRefundById.mockResolvedValue({
        id: refundId,
        orderId: 'order-cod',
        paymentId: 'pay-cod-1',
        amount: '500.00',
        reason: 'wrong_item',
        status: 'requested',
      });
      mockRefundsStore.findPaymentById.mockResolvedValue({
        id: 'pay-cod-1',
        status: 'completed',
        method: 'COD',
      });
      mockRefundsStore.findOrderByIdForUpdate.mockResolvedValue({
        id: 'order-cod',
        userId: 'user-1',
        status: 'delivered',
      });
      mockRefundsStore.findPaymentByIdForUpdate.mockResolvedValue({
        id: 'pay-cod-1',
      });
      mockRefundsStore.findRefundByIdForUpdate.mockResolvedValue({
        id: refundId,
        reason: 'wrong_item',
        status: 'requested',
      });
      mockRefundsStore.hasOrderBeenRestocked.mockResolvedValue(false);
      mockRefundsStore.hasRefundBeenRestocked.mockResolvedValue(false);
      mockRefundsStore.getOrderItems.mockResolvedValue([
        { productId: 'prod-1', variantId: 'var-1', quantity: 2 },
      ]);
      mockRefundsStore.findVariantById.mockResolvedValue({ id: 'var-1' });
      mockRefundsStore.getPointsSpentOnOrder.mockResolvedValue(50);
      mockRefundsStore.hasPointsBeenRefunded.mockResolvedValue(false);
      mockRefundsStore.updateRefund.mockResolvedValue({
        id: refundId,
        status: 'processed',
        gatewayRefundId: 'COD-CASH-VOUCHER-1',
      });

      const result = await service.processRefund(adminId, refundId, {
        status: 'processed',
        adminNotes: 'Cash refund voucher issued to customer at door',
      });

      // COD does NOT call external SSLCommerz provider
      expect(mockPaymentsService.initiateRefund).not.toHaveBeenCalled();
      expect(mockRefundsStore.updatePaymentStatus).toHaveBeenCalledWith(
        'pay-cod-1',
        { status: 'refunded' },
        expect.anything(),
      );
      expect(mockRefundsStore.updateOrderStatus).toHaveBeenCalledWith(
        'order-cod',
        { paymentStatus: 'refunded', status: 'refunded' },
        expect.anything(),
      );
      expect(mockRefundsStore.restockVariant).toHaveBeenCalledWith(
        'var-1',
        2,
        expect.anything(),
      );
      expect(mockLoyaltyService.refundPoints).toHaveBeenCalledWith(
        'user-1',
        50,
        'order-cod',
        expect.anything(),
      );
      expect(result.status).toBe('processed');
    });

    it('prevents duplicate restocking if order was previously cancelled', async () => {
      mockRefundsStore.findRefundById.mockResolvedValue({
        id: refundId,
        orderId: 'order-cancelled',
        paymentId: 'pay-1',
        amount: '200.00',
        reason: 'other',
        status: 'requested',
      });
      mockRefundsStore.findOrderByIdForUpdate.mockResolvedValue({
        id: 'order-cancelled',
        userId: 'user-1',
        status: 'cancelled', // Order was already cancelled!
      });
      mockRefundsStore.findPaymentByIdForUpdate.mockResolvedValue({
        id: 'pay-1',
      });
      mockRefundsStore.findRefundByIdForUpdate.mockResolvedValue({
        id: refundId,
        reason: 'other',
        status: 'requested',
      });
      mockRefundsStore.hasOrderBeenRestocked.mockResolvedValue(true);
      mockRefundsStore.hasRefundBeenRestocked.mockResolvedValue(false);
      mockRefundsStore.getPointsSpentOnOrder.mockResolvedValue(0);
      mockRefundsStore.updateRefund.mockResolvedValue({
        id: refundId,
        status: 'processed',
      });

      await service.processRefund(adminId, refundId, {
        status: 'processed',
        gatewayRefundId: 'MANUAL-REF',
      });

      expect(mockRefundsStore.restockProduct).not.toHaveBeenCalled();
      expect(mockRefundsStore.restockVariant).not.toHaveBeenCalled();
    });

    it('does not add damaged goods to saleable stock', async () => {
      mockRefundsStore.findRefundById.mockResolvedValue({
        id: refundId,
        orderId: 'order-dmg',
        amount: '300.00',
        reason: 'damaged_item',
        status: 'requested',
      });
      mockRefundsStore.findOrderByIdForUpdate.mockResolvedValue({
        id: 'order-dmg',
        userId: 'user-1',
        status: 'delivered',
      });
      mockRefundsStore.findRefundByIdForUpdate.mockResolvedValue({
        id: refundId,
        reason: 'damaged_item',
        status: 'requested',
      });
      mockRefundsStore.hasOrderBeenRestocked.mockResolvedValue(false);
      mockRefundsStore.hasRefundBeenRestocked.mockResolvedValue(false);
      mockRefundsStore.getOrderItems.mockResolvedValue([
        { productId: 'prod-dmg', variantId: null, quantity: 1 },
      ]);
      mockRefundsStore.getPointsSpentOnOrder.mockResolvedValue(0);
      mockRefundsStore.updateRefund.mockResolvedValue({
        id: refundId,
        status: 'processed',
      });

      await service.processRefund(adminId, refundId, {
        status: 'processed',
        gatewayRefundId: 'MANUAL-DMG-REF',
      });

      // Must NOT add to saleable product or variant stock
      expect(mockRefundsStore.restockProduct).not.toHaveBeenCalled();
      expect(mockRefundsStore.restockVariant).not.toHaveBeenCalled();
      // Must record inventory transaction as damaged
      expect(mockRefundsStore.createInventoryTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          productId: 'prod-dmg',
          notes: expect.stringContaining('Damaged item return'),
        }),
        expect.anything(),
      );
    });

    it('quarantines missing variant inventory instead of substituting parent product stock', async () => {
      mockRefundsStore.findRefundById.mockResolvedValue({
        id: refundId,
        orderId: 'order-variant-del',
        amount: '400.00',
        reason: 'wrong_item',
        status: 'requested',
      });
      mockRefundsStore.findOrderByIdForUpdate.mockResolvedValue({
        id: 'order-variant-del',
        userId: 'user-1',
        status: 'delivered',
      });
      mockRefundsStore.findRefundByIdForUpdate.mockResolvedValue({
        id: refundId,
        reason: 'wrong_item',
        status: 'requested',
      });
      mockRefundsStore.hasOrderBeenRestocked.mockResolvedValue(false);
      mockRefundsStore.hasRefundBeenRestocked.mockResolvedValue(false);
      mockRefundsStore.getOrderItems.mockResolvedValue([
        {
          productId: 'parent-prod-1',
          variantId: 'deleted-var-id',
          quantity: 3,
        },
      ]);
      // Variant does NOT exist anymore in database
      mockRefundsStore.findVariantById.mockResolvedValue(null);
      mockRefundsStore.getPointsSpentOnOrder.mockResolvedValue(0);
      mockRefundsStore.updateRefund.mockResolvedValue({
        id: refundId,
        status: 'processed',
      });

      await service.processRefund(adminId, refundId, {
        status: 'processed',
        gatewayRefundId: 'VAR-DEL-REF',
      });

      // Invariant: Must NOT increment parent product stock or variant stock
      expect(mockRefundsStore.restockVariant).not.toHaveBeenCalled();
      expect(mockRefundsStore.restockProduct).not.toHaveBeenCalled();
      // Invariant: Must quarantine in inventoryTransactions for warehouse reconciliation
      expect(mockRefundsStore.createInventoryTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          productId: 'parent-prod-1',
          quantity: 3,
          referenceId: refundId,
          notes: expect.stringContaining(
            'quarantined for warehouse reconciliation',
          ),
        }),
        expect.anything(),
      );
    });

    it('rejects COD refund if neither gatewayRefundId nor adminNotes is provided', async () => {
      mockRefundsStore.findRefundById.mockResolvedValue({
        id: refundId,
        orderId: 'order-cod',
        paymentId: 'pay-cod-1',
        amount: '250.00',
        reason: 'wrong_item',
        status: 'requested',
      });
      mockRefundsStore.findPaymentById.mockResolvedValue({
        id: 'pay-cod-1',
        status: 'completed',
        method: 'COD',
      });

      await expect(
        service.processRefund(adminId, refundId, {
          status: 'processed',
        }),
      ).rejects.toThrow('COD refund requires a recorded settlement reference');
    });

    it('rejects concurrent admin when refund is already claimed as processing', async () => {
      mockRefundsStore.findRefundById.mockResolvedValue({
        id: refundId,
        orderId: 'order-1',
        paymentId: 'pay-online-1',
        amount: '500.00',
        reason: 'wrong_item',
        status: 'requested',
      });
      mockRefundsStore.findPaymentById.mockResolvedValue({
        id: 'pay-online-1',
        status: 'completed',
        method: 'SSLCommerz',
      });
      // During atomic claim lock, status was already flipped to 'processing' by another concurrent admin
      mockRefundsStore.findRefundByIdForUpdate.mockResolvedValue({
        id: refundId,
        status: 'processing',
      });

      await expect(
        service.processRefund(adminId, refundId, {
          status: 'processed',
        }),
      ).rejects.toThrow(
        'Refund is currently being processed with payment provider',
      );

      // Crucial invariant: Provider API was NEVER called by the losing concurrent worker
      expect(mockPaymentsService.initiateRefund).not.toHaveBeenCalled();
    });
  });

  describe('reconcileRefund (Crash & Timeout Recovery - REF-G02 to REF-G08)', () => {
    const adminId = 'admin-rec';
    const refundId = 'ref-rec-1';

    it('REF-G03: Provider inquiry confirms settlement (status: refunded) -> finalizes settlement locally', async () => {
      mockRefundsStore.findRefundById.mockResolvedValue({
        id: refundId,
        orderId: 'order-rec',
        paymentId: 'pay-rec',
        amount: '600.00',
        reason: 'wrong_item',
        status: 'processing',
        gatewayRefundId: 'SSL-GATEWAY-REC',
      });
      mockPaymentsService.queryRefundStatus.mockResolvedValue({
        success: true,
        status: 'refunded',
        refundRefId: 'SSL-GATEWAY-REC',
        bankTranId: 'BANK-TRAN-REC',
        refundedOn: '2026-10-21 11:30:00',
      });
      mockRefundsStore.findOrderByIdForUpdate.mockResolvedValue({
        id: 'order-rec',
        userId: 'user-rec',
        status: 'delivered',
      });
      mockRefundsStore.findPaymentByIdForUpdate.mockResolvedValue({
        id: 'pay-rec',
      });
      mockRefundsStore.findRefundByIdForUpdate.mockResolvedValue({
        id: refundId,
        status: 'processing',
        gatewayRefundId: 'SSL-GATEWAY-REC',
        reason: 'wrong_item',
      });
      mockRefundsStore.hasOrderBeenRestocked.mockResolvedValue(false);
      mockRefundsStore.hasRefundBeenRestocked.mockResolvedValue(false);
      mockRefundsStore.getOrderItems.mockResolvedValue([]);
      mockRefundsStore.getPointsSpentOnOrder.mockResolvedValue(0);
      mockRefundsStore.updateRefund.mockResolvedValue({
        id: refundId,
        status: 'processed',
        gatewayRefundId: 'SSL-GATEWAY-REC',
      });

      const result = await service.reconcileRefund(adminId, refundId);

      expect(mockPaymentsService.queryRefundStatus).toHaveBeenCalledWith(
        'SSL-GATEWAY-REC',
        expect.anything(),
      );
      expect(mockRefundsStore.updateOrderStatus).toHaveBeenCalledWith(
        'order-rec',
        expect.objectContaining({ status: 'refunded' }),
        expect.anything(),
      );
      expect(result.status).toBe('processed');
    });

    it('REF-G02: Provider inquiry returns pending/processing -> preserves processing state', async () => {
      mockRefundsStore.findRefundById.mockResolvedValue({
        id: refundId,
        orderId: 'order-rec',
        status: 'processing',
        gatewayRefundId: 'SSL-GATEWAY-PENDING',
      });
      mockPaymentsService.queryRefundStatus.mockResolvedValue({
        success: true,
        status: 'processing',
        refundRefId: 'SSL-GATEWAY-PENDING',
        errorReason: 'Bank clearing in-flight',
      });
      mockRefundsStore.updateRefund.mockResolvedValue({
        id: refundId,
        status: 'processing',
      });

      const result = await service.reconcileRefund(adminId, refundId);

      expect(mockRefundsStore.updateRefund).toHaveBeenCalledWith(
        refundId,
        expect.objectContaining({
          status: 'processing',
          adminNotes: expect.stringContaining('still processing'),
        }),
      );
      expect(result.status).toBe('processing');
      expect(mockRefundsStore.updateOrderStatus).not.toHaveBeenCalled();
    });

    it("REF-G04: Provider inquiry returns status 'success' -> fails closed as unresolved, no premature finalization", async () => {
      mockRefundsStore.findRefundById.mockResolvedValue({
        id: refundId,
        orderId: 'order-rec',
        status: 'processing',
        gatewayRefundId: 'SSL-GATEWAY-REC',
      });
      mockPaymentsService.queryRefundStatus.mockResolvedValue({
        success: false,
        status: 'unknown_status',
        refundRefId: 'SSL-GATEWAY-REC',
        errorReason:
          "Unexpected 'success' status returned on inquiry; authoritative settlement requires status='refunded'",
      });
      mockRefundsStore.updateRefund.mockResolvedValue({
        id: refundId,
        status: 'processing',
      });

      const result = await service.reconcileRefund(adminId, refundId);

      expect(result.status).toBe('processing');
      expect(mockRefundsStore.updateRefund).toHaveBeenCalledWith(
        refundId,
        expect.objectContaining({
          status: 'processing',
          adminNotes: expect.stringContaining(
            'Gateway inquiry unresolved [unknown_status]',
          ),
        }),
      );
      expect(mockRefundsStore.updateOrderStatus).not.toHaveBeenCalled();
    });

    it('REF-G05 / REF-G06: Provider inquiry returns invalid_identity -> fails closed as unresolved, no finalization', async () => {
      mockRefundsStore.findRefundById.mockResolvedValue({
        id: refundId,
        orderId: 'order-rec',
        status: 'processing',
        gatewayRefundId: 'SSL-GATEWAY-REC',
      });
      mockPaymentsService.queryRefundStatus.mockResolvedValue({
        success: false,
        status: 'invalid_identity',
        refundRefId: 'SSL-GATEWAY-REC',
        errorReason: 'Provider returned mismatched bank_tran_id',
      });
      mockRefundsStore.updateRefund.mockResolvedValue({
        id: refundId,
        status: 'processing',
      });

      const result = await service.reconcileRefund(adminId, refundId);

      expect(result.status).toBe('processing');
      expect(mockRefundsStore.updateRefund).toHaveBeenCalledWith(
        refundId,
        expect.objectContaining({
          status: 'processing',
          adminNotes: expect.stringContaining('invalid_identity'),
        }),
      );
      expect(mockRefundsStore.updateOrderStatus).not.toHaveBeenCalled();
    });

    it('Provider inquiry confirms cancellation -> transitions to rejected', async () => {
      mockRefundsStore.findRefundById.mockResolvedValue({
        id: refundId,
        orderId: 'order-rec',
        status: 'processing',
        gatewayRefundId: 'SSL-GATEWAY-CANCELLED',
      });
      mockPaymentsService.queryRefundStatus.mockResolvedValue({
        success: false,
        status: 'cancelled',
        refundRefId: 'SSL-GATEWAY-CANCELLED',
        errorReason: 'Card issuer cancelled refund',
      });
      mockRefundsStore.updateRefund.mockResolvedValue({
        id: refundId,
        status: 'rejected',
      });

      const result = await service.reconcileRefund(adminId, refundId);

      expect(mockRefundsStore.updateRefund).toHaveBeenCalledWith(
        refundId,
        expect.objectContaining({
          status: 'rejected',
          adminNotes: expect.stringContaining('Card issuer cancelled refund'),
        }),
      );
      expect(result.status).toBe('rejected');
    });

    it('rejects reconciliation if refund has no gateway reference ID', async () => {
      mockRefundsStore.findRefundById.mockResolvedValue({
        id: refundId,
        orderId: 'order-rec',
        status: 'processing',
        gatewayRefundId: null, // Timeout occurred before gateway response returned
      });

      await expect(service.reconcileRefund(adminId, refundId)).rejects.toThrow(
        'Manual reconciliation required',
      );
    });
  });
});
