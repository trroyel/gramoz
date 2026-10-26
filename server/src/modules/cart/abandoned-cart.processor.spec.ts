import { Test, TestingModule } from '@nestjs/testing';
import { AbandonedCartProcessor } from './abandoned-cart.processor';
import { MailService } from '../notifications/mail.service';
import { SettingsService } from '../settings/settings.service';
import { DATABASE } from '@database/database.module';
import * as schema from '@database/schema';

describe('AbandonedCartProcessor (Unit Tests — TASK-19)', () => {
  let processor: AbandonedCartProcessor;
  let mockDb: any;
  let mockMailService: any;
  let mockSettingsService: any;

  beforeEach(async () => {
    mockDb = {
      execute: jest.fn(),
      transaction: jest.fn(),
    };

    mockMailService = {
      sendAbandonedCartEmail: jest.fn().mockResolvedValue(undefined),
    };

    mockSettingsService = {
      getAbandonedCartIdleHours: jest.fn().mockResolvedValue(24),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AbandonedCartProcessor,
        { provide: DATABASE, useValue: mockDb },
        { provide: MailService, useValue: mockMailService },
        { provide: SettingsService, useValue: mockSettingsService },
      ],
    }).compile();

    processor = module.get<AbandonedCartProcessor>(AbandonedCartProcessor);
  });

  describe('processAbandonedCarts', () => {
    it('should return 0 scanned and 0 enqueued when no abandoned carts exist', async () => {
      mockDb.execute.mockResolvedValueOnce({ rows: [] });

      const result = await processor.processAbandonedCarts();

      expect(result).toEqual({ scannedUsers: 0, enqueuedEvents: 0 });
      expect(mockSettingsService.getAbandonedCartIdleHours).toHaveBeenCalled();
      expect(mockDb.execute).toHaveBeenCalledTimes(1);
      expect(mockDb.transaction).not.toHaveBeenCalled();
    });

    it('should claim items and enqueue SEND_ABANDONED_CART_EMAIL for eligible candidate', async () => {
      const candidateUser = {
        userId: 'user-uuid-1',
        userEmail: 'customer@gramoz.com',
        userFullName: 'Gramoz Customer',
      };
      mockDb.execute.mockResolvedValueOnce({ rows: [candidateUser] });

      const mockTx = {
        execute: jest.fn(),
        insert: jest.fn().mockReturnThis(),
        values: jest.fn().mockResolvedValue({}),
      };

      // 1st tx call: UPDATE cart_items RETURNING claimed items
      mockTx.execute.mockResolvedValueOnce({
        rows: [
          {
            id: 'item-uuid-1',
            productId: 'prod-uuid-1',
            variantId: 'var-uuid-1',
            quantity: 2,
          },
        ],
      });

      // 2nd tx call: SELECT item details
      mockTx.execute.mockResolvedValueOnce({
        rows: [
          {
            cartItemId: 'item-uuid-1',
            quantity: 2,
            productName: 'Oxford Shirt',
            unitPrice: '1500.00',
            variantAttributes: { Size: 'L', Color: 'Navy' },
            productStock: 10,
            variantStock: 5,
          },
        ],
      });

      mockDb.transaction.mockImplementation(async (callback: any) => {
        return callback(mockTx);
      });

      const result = await processor.processAbandonedCarts();

      expect(result).toEqual({ scannedUsers: 1, enqueuedEvents: 1 });
      expect(mockTx.execute).toHaveBeenCalledTimes(2);
      expect(mockTx.insert).toHaveBeenCalledWith(schema.outboxEvents);
      expect(mockTx.values).toHaveBeenCalledWith({
        type: 'SEND_ABANDONED_CART_EMAIL',
        payload: {
          userId: candidateUser.userId,
          email: candidateUser.userEmail,
          fullName: candidateUser.userFullName,
          items: [
            {
              productName: 'Oxford Shirt (Size: L, Color: Navy)',
              quantity: 2,
              unitPrice: '1500.00',
            },
          ],
        },
      });
    });

    it('should skip enqueuing when another concurrent worker already claimed the items (CONC-19-K)', async () => {
      const candidateUser = {
        userId: 'user-uuid-2',
        userEmail: 'racing@gramoz.com',
        userFullName: 'Racing Customer',
      };
      mockDb.execute.mockResolvedValueOnce({ rows: [candidateUser] });

      const mockTx = {
        execute: jest.fn(),
        insert: jest.fn(),
      };

      // Atomic claim returns 0 rows because another worker set abandoned_email_sent = true
      mockTx.execute.mockResolvedValueOnce({ rows: [] });

      mockDb.transaction.mockImplementation(async (callback: any) => {
        return callback(mockTx);
      });

      const result = await processor.processAbandonedCarts();

      expect(result).toEqual({ scannedUsers: 1, enqueuedEvents: 0 });
      expect(mockTx.insert).not.toHaveBeenCalled();
    });

    it('should skip enqueuing if all claimed items are out of stock', async () => {
      const candidateUser = {
        userId: 'user-uuid-3',
        userEmail: 'out-of-stock@gramoz.com',
        userFullName: 'Out Of Stock User',
      };
      mockDb.execute.mockResolvedValueOnce({ rows: [candidateUser] });

      const mockTx = {
        execute: jest.fn(),
        insert: jest.fn(),
      };

      // 1st tx call: claimed items
      mockTx.execute.mockResolvedValueOnce({
        rows: [
          {
            id: 'item-uuid-2',
            productId: 'prod-uuid-2',
            variantId: null,
            quantity: 1,
          },
        ],
      });

      // 2nd tx call: item details show stock = 0
      mockTx.execute.mockResolvedValueOnce({
        rows: [
          {
            cartItemId: 'item-uuid-2',
            quantity: 1,
            productName: 'Sold Out Jacket',
            unitPrice: '3000.00',
            variantAttributes: null,
            productStock: 0,
            variantStock: null,
          },
        ],
      });

      mockDb.transaction.mockImplementation(async (callback: any) => {
        return callback(mockTx);
      });

      const result = await processor.processAbandonedCarts();

      expect(result).toEqual({ scannedUsers: 1, enqueuedEvents: 0 });
      expect(mockTx.insert).not.toHaveBeenCalled();
    });

    it('should handle database exception gracefully without throwing', async () => {
      mockDb.execute.mockRejectedValueOnce(new Error('Connection lost'));

      const result = await processor.processAbandonedCarts();

      expect(result).toEqual({ scannedUsers: 0, enqueuedEvents: 0 });
    });
  });
});
