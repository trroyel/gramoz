import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

describe('PaymentsController (HTTP Unit Tests)', () => {
  let controller: PaymentsController;
  let mockPaymentsService: any;
  let mockRes: any;

  beforeEach(() => {
    mockPaymentsService = {
      initiatePayment: jest.fn(),
      verifyPayment: jest.fn(),
      handleFailCallback: jest.fn(),
      handleCancelCallback: jest.fn(),
      initiateCod: jest.fn(),
    };

    controller = new PaymentsController(mockPaymentsService as PaymentsService);

    mockRes = {
      code: jest.fn().mockReturnThis(),
      status: jest.fn().mockReturnThis(),
      header: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    };
  });

  describe('POST /payments/initiate/:orderId', () => {
    it('initiates payment and returns JSON data', async () => {
      const mockUser = { id: 'user-1' } as any;
      const mockReq = {
        headers: { host: 'localhost:5000' },
        protocol: 'http',
      } as any;
      mockPaymentsService.initiatePayment.mockResolvedValue({
        gatewayUrl: 'https://sandbox.sslcommerz.com/gw/session-abc',
      });

      await controller.initiate(
        mockUser,
        'order-1',
        { method: 'sslcommerz' },
        mockReq,
        mockRes,
      );

      expect(mockPaymentsService.initiatePayment).toHaveBeenCalledWith(
        'user-1',
        'order-1',
        'http://localhost:5000',
        'sslcommerz',
      );
      expect(mockRes.send).toHaveBeenCalledWith({
        success: true,
        data: { gatewayUrl: 'https://sandbox.sslcommerz.com/gw/session-abc' },
      });
    });
  });

  describe('POST /payments/sslcommerz/success', () => {
    it('redirects to /checkout/success on verified payment', async () => {
      mockPaymentsService.verifyPayment.mockResolvedValue({
        success: true,
        message: 'Payment verified and order is now processing',
      });

      await controller.successCallback(
        { tran_id: 'TRN_1', val_id: 'VAL_1' },
        mockRes,
      );

      expect(mockRes.code).toHaveBeenCalledWith(302);
      expect(mockRes.header).toHaveBeenCalledWith(
        'Location',
        'http://localhost:3000/checkout/success',
      );
      expect(mockRes.send).toHaveBeenCalled();
    });

    it('redirects to /checkout/fail with reason when verification fails', async () => {
      mockPaymentsService.verifyPayment.mockResolvedValue({
        success: false,
        message: 'Payment amount mismatch',
      });

      await controller.successCallback(
        { tran_id: 'TRN_1', val_id: 'VAL_1' },
        mockRes,
      );

      expect(mockRes.code).toHaveBeenCalledWith(302);
      expect(mockRes.header).toHaveBeenCalledWith(
        'Location',
        expect.stringContaining(
          '/checkout/fail?reason=Payment%20amount%20mismatch',
        ),
      );
    });

    it('redirects to /checkout/fail with reason when service throws an error', async () => {
      mockPaymentsService.verifyPayment.mockRejectedValue(
        new Error('Network timeout'),
      );

      await controller.successCallback({ tran_id: 'TRN_1' }, mockRes);

      expect(mockRes.code).toHaveBeenCalledWith(302);
      expect(mockRes.header).toHaveBeenCalledWith(
        'Location',
        expect.stringContaining('/checkout/fail?reason=Network%20timeout'),
      );
    });
  });

  describe('POST /payments/sslcommerz/fail', () => {
    it('calls handleFailCallback and redirects to /checkout/fail', async () => {
      mockPaymentsService.handleFailCallback.mockResolvedValue(undefined);

      await controller.failCallback(
        { tran_id: 'TRN_FAIL', status: 'FAILED' },
        mockRes,
      );

      expect(mockPaymentsService.handleFailCallback).toHaveBeenCalledWith({
        tran_id: 'TRN_FAIL',
        status: 'FAILED',
      });
      expect(mockRes.code).toHaveBeenCalledWith(302);
      expect(mockRes.header).toHaveBeenCalledWith(
        'Location',
        'http://localhost:3000/checkout/fail',
      );
      expect(mockRes.send).toHaveBeenCalled();
    });
  });

  describe('POST /payments/sslcommerz/cancel', () => {
    it('calls handleCancelCallback and redirects to /checkout/cancel', async () => {
      mockPaymentsService.handleCancelCallback.mockResolvedValue(undefined);

      await controller.cancelCallback(
        { tran_id: 'TRN_CANCEL', status: 'CANCELLED' },
        mockRes,
      );

      expect(mockPaymentsService.handleCancelCallback).toHaveBeenCalledWith({
        tran_id: 'TRN_CANCEL',
        status: 'CANCELLED',
      });
      expect(mockRes.code).toHaveBeenCalledWith(302);
      expect(mockRes.header).toHaveBeenCalledWith(
        'Location',
        'http://localhost:3000/checkout/cancel',
      );
      expect(mockRes.send).toHaveBeenCalled();
    });
  });

  describe('POST /payments/sslcommerz/ipn', () => {
    it('returns HTTP 200 "IPN Received" when payment verification succeeds', async () => {
      mockPaymentsService.verifyPayment.mockResolvedValue({
        success: true,
        message: 'Payment verified',
      });

      await controller.ipnListener(
        { tran_id: 'TRN_IPN', val_id: 'VAL_IPN' },
        mockRes,
      );

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.send).toHaveBeenCalledWith('IPN Received');
    });

    it('returns HTTP 400 Bad Request when payment verification fails', async () => {
      mockPaymentsService.verifyPayment.mockResolvedValue({
        success: false,
        message: 'Invalid IPN signature',
      });

      await controller.ipnListener(
        { tran_id: 'TRN_BAD', val_id: 'VAL_BAD' },
        mockRes,
      );

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.send).toHaveBeenCalledWith('Invalid IPN signature');
    });
  });

  describe('POST /payments/cod/:orderId', () => {
    it('creates COD payment and returns 201 Created', async () => {
      const mockUser = { id: 'user-cod' } as any;
      const mockPayment = { id: 'pay-cod-1', method: 'COD', status: 'pending' };
      mockPaymentsService.initiateCod.mockResolvedValue(mockPayment);

      await controller.initiateCod(mockUser, 'order-cod-1', mockRes);

      expect(mockPaymentsService.initiateCod).toHaveBeenCalledWith(
        'user-cod',
        'order-cod-1',
      );
      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.send).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: mockPayment,
        }),
      );
    });
  });
});
