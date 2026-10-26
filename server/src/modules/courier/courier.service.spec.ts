import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CourierService, ConsignmentRequest } from './courier.service';
import { DATABASE } from '../../database/database.module';
import * as schema from '../../database/schema';

describe('CourierService (Unit & Contract Tests — TASK-24)', () => {
  let service: CourierService;
  let mockDb: any;
  let mockConfigService: any;

  beforeEach(async () => {
    mockDb = {
      select: jest.fn(),
      query: {
        orders: {
          findFirst: jest.fn(),
        },
      },
    };

    mockConfigService = {
      get: jest.fn((key: string, defaultVal: string) => defaultVal),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CourierService,
        { provide: DATABASE, useValue: mockDb },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<CourierService>(CourierService);
    jest.restoreAllMocks();
  });

  describe('calculateCharge (B-COU-01)', () => {
    it('calculates home delivery charge for base weight (<= 1kg)', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValueOnce({
          where: jest.fn().mockResolvedValueOnce([
            {
              id: 'zone-dhaka-1',
              homeDeliveryCharge: '60.00',
              branchPickupCharge: '40.00',
              estimatedDays: '1-2 days',
            },
          ]),
        }),
      });

      const res = await service.calculateCharge('zone-dhaka-1', 'home', 0.5);
      expect(res).toEqual({
        charge: 60,
        estimatedDays: '1-2 days',
      });
    });

    it('calculates branch pickup charge for base weight', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValueOnce({
          where: jest.fn().mockResolvedValueOnce([
            {
              id: 'zone-dhaka-1',
              homeDeliveryCharge: '60.00',
              branchPickupCharge: '40.00',
              estimatedDays: '1-2 days',
            },
          ]),
        }),
      });

      const res = await service.calculateCharge('zone-dhaka-1', 'branch', 0.8);
      expect(res).toEqual({
        charge: 40,
        estimatedDays: '1-2 days',
      });
    });

    it('adds 15 BDT per extra kg above 1kg with Math.ceil rounding', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValueOnce({
          where: jest.fn().mockResolvedValueOnce([
            {
              id: 'zone-outside-1',
              homeDeliveryCharge: '120.00',
              branchPickupCharge: '90.00',
              estimatedDays: '3-5 days',
            },
          ]),
        }),
      });

      // 2.3 kg -> extra = ceil(1.3) = 2 extra kg -> 120 + (2 * 15) = 150 BDT
      const res = await service.calculateCharge('zone-outside-1', 'home', 2.3);
      expect(res.charge).toBe(150);
    });

    it('sanitizes negative or invalid weights to default 0.5kg', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValueOnce({
          where: jest.fn().mockResolvedValueOnce([
            {
              id: 'zone-dhaka-1',
              homeDeliveryCharge: '60.00',
              branchPickupCharge: '40.00',
              estimatedDays: '2-3 days',
            },
          ]),
        }),
      });

      const res = await service.calculateCharge('zone-dhaka-1', 'home', -5);
      expect(res.charge).toBe(60);
    });

    it('throws an error if shipping zone does not exist', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValueOnce({
          where: jest.fn().mockResolvedValueOnce([]),
        }),
      });

      await expect(
        service.calculateCharge('non-existent-zone', 'home', 1),
      ).rejects.toThrow('Zone not found');
    });
  });

  describe('createConsignment (B-COU-02)', () => {
    const consignmentReq: ConsignmentRequest = {
      orderId: 'order-uuid-101',
      recipientName: 'Tariq Rahman',
      recipientPhone: '01711112222',
      recipientAddress: 'Banani, Road 11',
      recipientCity: 'Dhaka',
      amountToCollect: 1500,
      itemQuantity: 2,
      itemWeight: 0.5,
    };

    it('returns mock consignment when credentials are in mock mode', async () => {
      // Mock DB settings returns mock mode
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValueOnce({
          where: jest.fn().mockResolvedValueOnce([
            {
              key: 'COURIER_SETTINGS',
              value: JSON.stringify({
                mode: 'mock',
                apiKey: '',
                secretKey: '',
              }),
            },
          ]),
        }),
      });

      const res = await service.createConsignment(consignmentReq);

      expect(res.success).toBe(true);
      expect(res.consignmentId).toMatch(/^SF-MOCK-/);
      expect(res.trackingUrl).toContain('https://steadfast.com.bd/t/');
    });

    it('calls Steadfast /create_order API and returns tracking details in live mode', async () => {
      // Live credentials
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValueOnce({
          where: jest.fn().mockResolvedValueOnce([
            {
              key: 'COURIER_SETTINGS',
              value: JSON.stringify({
                mode: 'live',
                apiKey: 'test-api-key',
                secretKey: 'test-secret-key',
              }),
            },
          ]),
        }),
      });

      const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 200,
          message: 'Consignment created successfully',
          data: {
            consignment_id: 'STEADFAST-LIVE-999',
            tracking_code: 'SF999ABC',
          },
        }),
      } as Response);

      const res = await service.createConsignment(consignmentReq);

      expect(fetchMock).toHaveBeenCalledWith(
        'https://portal.steadfast.com.bd/api/v1/create_order',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Api-Key': 'test-api-key',
            'Secret-Key': 'test-secret-key',
          }),
        }),
      );
      expect(res.success).toBe(true);
      expect(res.consignmentId).toBe('SF999ABC');
      expect(res.trackingUrl).toBe('https://steadfast.com.bd/t/SF999ABC');
    });

    it('handles provider error response gracefully', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValueOnce({
          where: jest.fn().mockResolvedValueOnce([
            {
              key: 'COURIER_SETTINGS',
              value: JSON.stringify({
                mode: 'live',
                apiKey: 'test-api-key',
                secretKey: 'test-secret-key',
              }),
            },
          ]),
        }),
      });

      jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          status: 400,
          message: 'Invalid recipient phone number',
        }),
      } as Response);

      const res = await service.createConsignment(consignmentReq);

      expect(res.success).toBe(false);
      expect(res.message).toBe('Invalid recipient phone number');
    });

    it('handles provider network timeout or fetch error gracefully', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValueOnce({
          where: jest.fn().mockResolvedValueOnce([
            {
              key: 'COURIER_SETTINGS',
              value: JSON.stringify({
                mode: 'live',
                apiKey: 'test-api-key',
                secretKey: 'test-secret-key',
              }),
            },
          ]),
        }),
      });

      jest
        .spyOn(global, 'fetch')
        .mockRejectedValueOnce(new Error('Connection timed out'));

      const res = await service.createConsignment(consignmentReq);

      expect(res.success).toBe(false);
      expect(res.message).toBe('Courier API unreachable');
    });
  });

  describe('getConsignmentByInvoice', () => {
    it('returns null if mode is mock or credentials not set', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValueOnce({
          where: jest.fn().mockResolvedValueOnce([]),
        }),
      });

      const res = await service.getConsignmentByInvoice('order-uuid-1');
      expect(res).toBeNull();
    });

    it('queries /status_by_invoice and returns existing consignment if found', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValueOnce({
          where: jest.fn().mockResolvedValueOnce([
            {
              key: 'COURIER_SETTINGS',
              value: JSON.stringify({
                mode: 'live',
                apiKey: 'test-api-key',
                secretKey: 'test-secret-key',
              }),
            },
          ]),
        }),
      });

      jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 200,
          message: 'Order found',
          delivery_status: {
            consignment_id: '123456',
            tracking_code: 'SF-RECOVERED-789',
            status: 'in_review',
          },
        }),
      } as Response);

      const res = await service.getConsignmentByInvoice('order-uuid-1');

      expect(res).toEqual({
        success: true,
        consignmentId: 'SF-RECOVERED-789',
        trackingCode: 'SF-RECOVERED-789',
        trackingUrl: 'https://steadfast.com.bd/t/SF-RECOVERED-789',
        message: 'Order found',
      });
    });

    it('returns null if order is not found (404) at provider', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValueOnce({
          where: jest.fn().mockResolvedValueOnce([
            {
              key: 'COURIER_SETTINGS',
              value: JSON.stringify({
                mode: 'live',
                apiKey: 'test-api-key',
                secretKey: 'test-secret-key',
              }),
            },
          ]),
        }),
      });

      jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 404,
      } as Response);

      const res = await service.getConsignmentByInvoice('order-uuid-missing');
      expect(res).toBeNull();
    });
  });

  describe('trackConsignment', () => {
    it('returns simulated mock tracking timeline and destination coordinates', async () => {
      mockDb.query.orders.findFirst.mockResolvedValueOnce({
        id: 'order-1',
        status: 'out_for_delivery',
        shippingAddress: {
          latitude: '23.8103',
          longitude: '90.4125',
        },
      });

      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValueOnce({
          where: jest.fn().mockResolvedValueOnce([
            {
              key: 'COURIER_SETTINGS',
              value: JSON.stringify({
                mode: 'mock',
                apiKey: '',
                secretKey: '',
              }),
            },
          ]),
        }),
      });

      const res = await service.trackConsignment('SF-MOCK-123456');

      expect(res.success).toBe(true);
      expect(res.isMock).toBe(true);
      expect(res.currentStatus).toBe('Out for Delivery');
      expect(res.destination).toEqual([23.8103, 90.4125]);
      expect(res.timeline.length).toBe(5);
    });
  });

  describe('getRegions', () => {
    it('fetches all active divisions, districts, and zones', async () => {
      mockDb.select
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValueOnce({
            where: jest
              .fn()
              .mockResolvedValueOnce([{ id: 'div-1', name: 'Dhaka' }]),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValueOnce({
            where: jest
              .fn()
              .mockResolvedValueOnce([{ id: 'dist-1', name: 'Dhaka' }]),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValueOnce({
            where: jest
              .fn()
              .mockResolvedValueOnce([{ id: 'zone-1', name: 'Gulshan' }]),
          }),
        });

      const res = await service.getRegions();

      expect(res.divisions.length).toBe(1);
      expect(res.districts.length).toBe(1);
      expect(res.zones.length).toBe(1);
    });
  });
});
