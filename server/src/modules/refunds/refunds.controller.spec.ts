import { Test, TestingModule } from '@nestjs/testing';
import { RefundsController } from './refunds.controller';
import { RefundsService } from './refunds.service';
import { HttpStatus } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

describe('RefundsController (Unit Tests)', () => {
  let controller: RefundsController;
  let mockRefundsService: any;
  let mockRes: Partial<FastifyReply>;

  const mockUser: any = {
    id: 'user-uuid-1',
    email: 'customer@example.com',
    role: 'customer',
  };

  const mockAdmin: any = {
    id: 'admin-uuid-1',
    email: 'admin@example.com',
    role: 'admin',
  };

  beforeEach(async () => {
    mockRefundsService = {
      requestRefund: jest.fn(),
      getMyRefunds: jest.fn(),
      getAllRefunds: jest.fn(),
      getRefundById: jest.fn(),
      processRefund: jest.fn(),
      reconcileRefund: jest.fn(),
    };

    mockRes = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RefundsController],
      providers: [{ provide: RefundsService, useValue: mockRefundsService }],
    }).compile();

    controller = module.get<RefundsController>(RefundsController);
  });

  describe('requestRefund (POST /refunds)', () => {
    it('submits a refund request and returns 201 Created', async () => {
      const dto = {
        orderId: 'order-123',
        amount: 250.0,
        reason: 'wrong_item' as const,
        notes: 'Size mismatch',
      };

      const mockRefund = { id: 'ref-1', ...dto, status: 'requested' };
      mockRefundsService.requestRefund.mockResolvedValue(mockRefund);

      await controller.requestRefund(mockUser, dto, mockRes as FastifyReply);

      expect(mockRefundsService.requestRefund).toHaveBeenCalledWith(
        mockUser.id,
        dto,
      );
      expect(mockRes.status).toHaveBeenCalledWith(HttpStatus.CREATED);
      expect(mockRes.send).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: mockRefund,
        }),
      );
    });
  });

  describe('getMyRefunds (GET /refunds/my)', () => {
    it('returns customer refund history', async () => {
      const mockRefunds = [{ id: 'ref-1', amount: '250.00' }];
      mockRefundsService.getMyRefunds.mockResolvedValue(mockRefunds);

      await controller.getMyRefunds(mockUser, mockRes as FastifyReply);

      expect(mockRefundsService.getMyRefunds).toHaveBeenCalledWith(mockUser.id);
      expect(mockRes.send).toHaveBeenCalledWith({
        success: true,
        data: mockRefunds,
      });
    });
  });

  describe('getAllRefunds (GET /refunds/admin/all)', () => {
    it('returns paginated refunds for admin', async () => {
      const mockList = [{ id: 'ref-1' }, { id: 'ref-2' }];
      mockRefundsService.getAllRefunds.mockResolvedValue(mockList);

      await controller.getAllRefunds(
        'requested',
        '1',
        '20',
        mockRes as FastifyReply,
      );

      expect(mockRefundsService.getAllRefunds).toHaveBeenCalledWith(
        'requested',
        1,
        20,
      );
      expect(mockRes.send).toHaveBeenCalledWith({
        success: true,
        data: mockList,
      });
    });
  });

  describe('getRefundDetails (GET /refunds/admin/:id)', () => {
    it('returns single refund details', async () => {
      const mockDetail = { id: 'ref-1', amount: '100.00' };
      mockRefundsService.getRefundById.mockResolvedValue(mockDetail);

      await controller.getRefundDetails('ref-1', mockRes as FastifyReply);

      expect(mockRefundsService.getRefundById).toHaveBeenCalledWith('ref-1');
      expect(mockRes.send).toHaveBeenCalledWith({
        success: true,
        data: mockDetail,
      });
    });
  });

  describe('updateRefundStatus (PATCH /refunds/admin/:id/status)', () => {
    it('processes refund and returns updated data', async () => {
      const dto = {
        status: 'approved' as const,
        adminNotes: 'Valid claim',
      };
      const mockUpdated = { id: 'ref-1', status: 'approved' };
      mockRefundsService.processRefund.mockResolvedValue(mockUpdated);

      await controller.updateRefundStatus(
        mockAdmin,
        'ref-1',
        dto,
        mockRes as FastifyReply,
      );

      expect(mockRefundsService.processRefund).toHaveBeenCalledWith(
        mockAdmin.id,
        'ref-1',
        dto,
      );
      expect(mockRes.send).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: 'Refund approved successfully',
          data: mockUpdated,
        }),
      );
    });
  });

  describe('reconcileRefund (POST /refunds/admin/:id/reconcile)', () => {
    it('executes reconciliation and returns result', async () => {
      const mockReconciled = {
        id: 'ref-1',
        status: 'processed',
        gatewayRefundId: 'SSL-GATEWAY-123',
      };
      mockRefundsService.reconcileRefund.mockResolvedValue(mockReconciled);

      await controller.reconcileRefund(
        mockAdmin,
        'ref-1',
        mockRes as FastifyReply,
      );

      expect(mockRefundsService.reconcileRefund).toHaveBeenCalledWith(
        mockAdmin.id,
        'ref-1',
      );
      expect(mockRes.send).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: 'Refund reconciliation executed successfully',
          data: mockReconciled,
        }),
      );
    });
  });
});
