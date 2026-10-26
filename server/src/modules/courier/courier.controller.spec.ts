import { Test, TestingModule } from '@nestjs/testing';
import { CourierController } from './courier.controller';
import { AdminCourierController } from './admin-courier.controller';
import { CourierService } from './courier.service';
import { DATABASE } from '../../database/database.module';

describe('CourierController & AdminCourierController (Unit Tests — TASK-24)', () => {
  let courierController: CourierController;
  let adminCourierController: AdminCourierController;
  let mockCourierService: any;
  let mockDb: any;

  beforeEach(async () => {
    mockCourierService = {
      trackConsignment: jest.fn(),
      getRegions: jest.fn(),
      calculateCharge: jest.fn(),
    };

    mockDb = {
      select: jest.fn(),
      insert: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      onConflictDoUpdate: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockResolvedValue({}),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CourierController, AdminCourierController],
      providers: [
        { provide: CourierService, useValue: mockCourierService },
        { provide: DATABASE, useValue: mockDb },
      ],
    }).compile();

    courierController = module.get<CourierController>(CourierController);
    adminCourierController = module.get<AdminCourierController>(
      AdminCourierController,
    );
  });

  describe('CourierController', () => {
    it('trackPackage: returns tracking information from CourierService', async () => {
      const mockTracking = {
        success: true,
        trackingCode: 'SF-12345',
        currentStatus: 'In Transit',
      };
      mockCourierService.trackConsignment.mockResolvedValueOnce(mockTracking);

      const mockRes: any = {
        send: jest.fn((val) => val),
      };

      const result = await courierController.trackPackage('SF-12345', mockRes);
      expect(mockCourierService.trackConsignment).toHaveBeenCalledWith(
        'SF-12345',
      );
      expect(mockRes.send).toHaveBeenCalledWith(mockTracking);
    });

    it('getRegions: returns divisions, districts, and zones', async () => {
      const mockRegions = { divisions: [], districts: [], zones: [] };
      mockCourierService.getRegions.mockResolvedValueOnce(mockRegions);

      const mockRes: any = {
        send: jest.fn((val) => val),
      };

      await courierController.getRegions(mockRes);
      expect(mockRes.send).toHaveBeenCalledWith(mockRegions);
    });

    it('calculateCharge: returns 400 if zoneId is missing', async () => {
      const mockRes: any = {
        status: jest.fn().mockReturnThis(),
        send: jest.fn((val) => val),
      };

      await courierController.calculateCharge(
        { zoneId: '', deliveryMethod: 'home' },
        mockRes,
      );

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.send).toHaveBeenCalledWith({
        success: false,
        message: 'zoneId is required',
      });
    });

    it('calculateCharge: returns calculated charge and estimated days on valid input', async () => {
      mockCourierService.calculateCharge.mockResolvedValueOnce({
        charge: 60,
        estimatedDays: '1-2 days',
      });

      const mockRes: any = {
        send: jest.fn((val) => val),
      };

      await courierController.calculateCharge(
        { zoneId: 'zone-1', deliveryMethod: 'home', weightKg: 0.5 },
        mockRes,
      );

      expect(mockCourierService.calculateCharge).toHaveBeenCalledWith(
        'zone-1',
        'home',
        0.5,
      );
      expect(mockRes.send).toHaveBeenCalledWith({
        success: true,
        charge: 60,
        estimatedDays: '1-2 days',
      });
    });

    it('calculateCharge: returns 400 with error message when service throws', async () => {
      mockCourierService.calculateCharge.mockRejectedValueOnce(
        new Error('Zone not found'),
      );

      const mockRes: any = {
        status: jest.fn().mockReturnThis(),
        send: jest.fn((val) => val),
      };

      await courierController.calculateCharge(
        { zoneId: 'invalid-zone', deliveryMethod: 'home' },
        mockRes,
      );

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.send).toHaveBeenCalledWith({
        success: false,
        message: 'Zone not found',
      });
    });
  });

  describe('AdminCourierController', () => {
    it('getSettings: returns courier settings from database', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValueOnce({
          where: jest.fn().mockResolvedValueOnce([
            {
              key: 'COURIER_SETTINGS',
              value: JSON.stringify({
                mode: 'live',
                apiKey: 'key1',
                secretKey: 'sec1',
              }),
            },
          ]),
        }),
      });

      const res = await adminCourierController.getSettings();
      expect(res.success).toBe(true);
      expect(res.data).toEqual({
        mode: 'live',
        apiKey: 'key1',
        secretKey: 'sec1',
      });
    });

    it('updateSettings: writes updated courier credentials to database', async () => {
      const res = await adminCourierController.updateSettings({
        mode: 'live',
        apiKey: 'new-key',
        secretKey: 'new-secret',
      });

      expect(res.success).toBe(true);
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('getZones: returns all divisions, districts, and zones for administration', async () => {
      mockDb.select
        .mockReturnValueOnce({
          from: jest.fn().mockResolvedValueOnce(['div1']),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockResolvedValueOnce(['dist1']),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockResolvedValueOnce(['zone1']),
        });

      const res = await adminCourierController.getZones();
      expect(res.success).toBe(true);
      expect(res.data).toEqual({
        divisions: ['div1'],
        districts: ['dist1'],
        zones: ['zone1'],
      });
    });

    it('updateZoneCharge: updates delivery charges for a zone', async () => {
      const res = await adminCourierController.updateZoneCharge('zone-1', {
        homeDeliveryCharge: '70.00',
        branchPickupCharge: '50.00',
      });

      expect(res.success).toBe(true);
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('getReconciliations: returns unresolved reconciliation items', async () => {
      mockCourierService.getUnresolvedReconciliations = jest
        .fn()
        .mockResolvedValueOnce({
          items: [{ eventId: 'e-1', orderId: 'o-1' }],
          pagination: { total: 1, page: 1, limit: 20, totalPages: 1 },
        });

      const res = await adminCourierController.getReconciliations('1', '20');
      expect(res.success).toBe(true);
      expect(res.items).toHaveLength(1);
      expect(
        mockCourierService.getUnresolvedReconciliations,
      ).toHaveBeenCalledWith(1, 20);
    });

    it('getReconciliationDetail: returns detail for specific outbox event', async () => {
      mockCourierService.getReconciliationDetail = jest
        .fn()
        .mockResolvedValueOnce({
          event: { id: 'e-1' },
          order: { id: 'o-1' },
        });

      const res = await adminCourierController.getReconciliationDetail('e-1');
      expect(res.success).toBe(true);
      expect(res.data.event.id).toBe('e-1');
      expect(mockCourierService.getReconciliationDetail).toHaveBeenCalledWith(
        'e-1',
      );
    });

    it('resolveReconciliation: executes authoritative resolution with admin identity', async () => {
      mockCourierService.reconcileCourierDispatch = jest
        .fn()
        .mockResolvedValueOnce({
          action: 'ADOPT_CONSIGNMENT',
          orderId: 'o-1',
          consignmentId: 'CID-100',
          auditTrail: 'reconciled by admin',
        });

      const mockAdmin: any = {
        id: 'adm-1',
        email: 'admin@gramoz.com',
        role: 'admin',
      };
      const res = await adminCourierController.resolveReconciliation(
        mockAdmin,
        'e-1',
        {
          action: 'ADOPT_CONSIGNMENT',
          consignmentId: 'CID-100',
          notes: 'Adopted',
        },
      );

      expect(res.success).toBe(true);
      expect(res.action).toBe('ADOPT_CONSIGNMENT');
      expect(mockCourierService.reconcileCourierDispatch).toHaveBeenCalledWith(
        { id: 'adm-1', email: 'admin@gramoz.com' },
        'e-1',
        {
          action: 'ADOPT_CONSIGNMENT',
          consignmentId: 'CID-100',
          notes: 'Adopted',
        },
      );
    });
  });
});
