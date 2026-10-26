/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { OutboxProcessor } from './outbox.processor';
import { CourierService } from '../courier/courier.service';
import { MailService } from '../notifications/mail.service';
import { SmsService } from '../notifications/sms.service';
import * as schema from '@database/schema';

describe('OutboxProcessor (Unit Tests)', () => {
  let processor: OutboxProcessor;
  let mockDb: any;
  let mockCourierService: any;
  let mockMailService: any;
  let mockSmsService: any;

  beforeEach(() => {
    mockDb = {
      execute: jest.fn(),
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockImplementation(() => {
        const promise: any = Promise.resolve({});
        promise.returning = jest
          .fn()
          .mockResolvedValue([{ id: 'mock-order-id' }]);
        return promise;
      }),
      insert: jest.fn().mockReturnThis(),
      values: jest.fn().mockResolvedValue({}),
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
    };

    mockCourierService = {
      createConsignment: jest.fn(),
      getConsignmentByInvoice: jest.fn().mockResolvedValue(null),
    };

    mockMailService = {
      sendOrderConfirmation: jest.fn(),
      sendLowStockAlert: jest.fn(),
    };

    mockSmsService = {
      sendOrderShippedSms: jest.fn().mockResolvedValue(true),
      sendOrderDeliveredSms: jest.fn().mockResolvedValue(true),
    };

    processor = new OutboxProcessor(
      mockDb,
      mockCourierService as unknown as CourierService,
      mockMailService as unknown as MailService,
      mockSmsService as unknown as SmsService,
    );
  });

  describe('recoverStrandedEvents', () => {
    it('executes SQL update on processing events exceeding 5 min lease and returns count', async () => {
      mockDb.execute.mockResolvedValueOnce({
        rows: [{ id: 'evt-1' }, { id: 'evt-2' }],
      });

      const count = await processor.recoverStrandedEvents();

      expect(mockDb.execute).toHaveBeenCalledTimes(1);
      expect(count).toBe(2);
    });

    it('returns 0 if no stranded events exist', async () => {
      mockDb.execute.mockResolvedValueOnce({
        rows: [],
      });

      const count = await processor.recoverStrandedEvents();
      expect(count).toBe(0);
    });
  });

  describe('processOutbox', () => {
    it('handles empty queue gracefully', async () => {
      // recoverStrandedEvents
      mockDb.execute.mockResolvedValueOnce({ rows: [] });
      // claim query
      mockDb.execute.mockResolvedValueOnce({ rows: [] });

      const result = await processor.processOutbox();

      expect(result).toEqual({
        claimed: 0,
        completed: 0,
        failed: 0,
        recovered: 0,
      });
    });

    it('processes a claimed event successfully to completed', async () => {
      const mockEvent: schema.OutboxEvent = {
        id: 'evt-101',
        type: 'SEND_ORDER_CONFIRMATION',
        payload: {
          email: 'customer@example.com',
          fullName: 'Alice Test',
          orderId: 'order-101',
          items: [{ productName: 'Dress', quantity: 1, unitPrice: '500' }],
          totalAmount: '500',
        },
        status: 'processing',
        attempts: 1,
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // 1. recoverStrandedEvents
      mockDb.execute.mockResolvedValueOnce({ rows: [] });
      // 2. claim query
      mockDb.execute.mockResolvedValueOnce({ rows: [mockEvent] });
      // Mail service success
      mockMailService.sendOrderConfirmation.mockResolvedValueOnce(undefined);

      const result = await processor.processOutbox();

      expect(result).toEqual({
        claimed: 1,
        completed: 1,
        failed: 0,
        recovered: 0,
      });
      expect(mockMailService.sendOrderConfirmation).toHaveBeenCalledWith(
        'customer@example.com',
        'Alice Test',
        'order-101',
        [{ productName: 'Dress', quantity: 1, unitPrice: '500' }],
        '500',
      );
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('processes multiple pending events in a single batch', async () => {
      const mockEvent1: schema.OutboxEvent = {
        id: 'evt-1',
        type: 'SEND_SMS',
        payload: { type: 'shipped', phone: '01700000001', orderId: 'ord-1' },
        status: 'processing',
        attempts: 1,
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const mockEvent2: schema.OutboxEvent = {
        id: 'evt-2',
        type: 'SEND_SMS',
        payload: { type: 'delivered', phone: '01700000002', orderId: 'ord-2' },
        status: 'processing',
        attempts: 1,
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockDb.execute.mockResolvedValueOnce({ rows: [] }); // recover
      mockDb.execute.mockResolvedValueOnce({ rows: [mockEvent1, mockEvent2] }); // claim

      const result = await processor.processOutbox();

      expect(result).toEqual({
        claimed: 2,
        completed: 2,
        failed: 0,
        recovered: 0,
      });
      expect(mockSmsService.sendOrderShippedSms).toHaveBeenCalledWith(
        '01700000001',
        'ord-1',
        undefined,
      );
      expect(mockSmsService.sendOrderDeliveredSms).toHaveBeenCalledWith(
        '01700000002',
        'ord-2',
      );
    });

    it('catches top-level DB error without unhandled promise rejection or crash', async () => {
      mockDb.execute.mockRejectedValueOnce(
        new Error('PostgreSQL connection drop'),
      );

      const result = await processor.processOutbox();

      expect(result).toEqual({
        claimed: 0,
        completed: 0,
        failed: 0,
        recovered: 0,
      });
    });
  });

  describe('processEvent - Provider Success Scenarios', () => {
    it('CREATE_CONSIGNMENT: fetches order details, calls courier API, updates order and queues SMS', async () => {
      const event: schema.OutboxEvent = {
        id: 'evt-courier-1',
        type: 'CREATE_CONSIGNMENT',
        payload: { orderId: 'order-c1' },
        status: 'processing',
        attempts: 1,
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Mock DB lookups for order, user, address, items
      mockDb.select.mockImplementation(() => ({
        from: jest.fn().mockImplementation((table: any) => ({
          where: jest.fn().mockImplementation(() => {
            if (table === schema.orders) {
              return Promise.resolve([
                {
                  id: 'order-c1',
                  userId: 'user-c1',
                  shippingAddressId: 'addr-c1',
                  totalAmount: '1250.00',
                  consignmentId: null,
                },
              ]);
            }
            if (table === schema.users) {
              return Promise.resolve([
                { id: 'user-c1', fullName: 'Rahim Khan', phone: '01811111111' },
              ]);
            }
            if (table === schema.addresses) {
              return Promise.resolve([
                {
                  id: 'addr-c1',
                  addressLine1: 'House 1, Road 2, Dhanmondi',
                  city: 'Dhaka',
                },
              ]);
            }
            if (table === schema.orderItems) {
              return Promise.resolve([{ quantity: 2 }, { quantity: 1 }]);
            }
            return Promise.resolve([]);
          }),
        })),
      }));

      mockCourierService.createConsignment.mockResolvedValueOnce({
        success: true,
        consignmentId: 'STEADFAST-999',
        trackingUrl: 'https://steadfast.com.bd/track/999',
      });

      const success = await processor.processEvent(event);

      expect(success).toBe(true);
      expect(mockCourierService.createConsignment).toHaveBeenCalledWith({
        orderId: 'order-c1',
        recipientName: 'Rahim Khan',
        recipientPhone: '01811111111',
        recipientAddress: 'House 1, Road 2, Dhanmondi',
        recipientCity: 'Dhaka',
        amountToCollect: 1250.0,
        itemQuantity: 3,
        itemWeight: 0.5,
      });

      // Verify order updated with consignment info
      expect(mockDb.update).toHaveBeenCalledWith(schema.orders);
      // Verify outbox queued for SEND_SMS
      expect(mockDb.insert).toHaveBeenCalledWith(schema.outboxEvents);
      // Verify outbox event itself completed
      expect(mockDb.update).toHaveBeenCalledWith(schema.outboxEvents);
    });

    it('CREATE_CONSIGNMENT: skips external API call if order already has consignmentId (idempotency guard)', async () => {
      const event: schema.OutboxEvent = {
        id: 'evt-courier-2',
        type: 'CREATE_CONSIGNMENT',
        payload: { orderId: 'order-c2' },
        status: 'processing',
        attempts: 1,
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockDb.select.mockImplementation(() => ({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([
            {
              id: 'order-c2',
              consignmentId: 'EXISTING-CONS-ID',
            },
          ]),
        }),
      }));

      const success = await processor.processEvent(event);

      expect(success).toBe(true);
      expect(mockCourierService.createConsignment).not.toHaveBeenCalled();
      expect(mockDb.update).toHaveBeenCalledWith(schema.outboxEvents);
    });

    it('CREATE_CONSIGNMENT: sets amountToCollect to 0 when paymentStatus is paid (COD financial invariant)', async () => {
      const event: schema.OutboxEvent = {
        id: 'evt-courier-paid',
        type: 'CREATE_CONSIGNMENT',
        payload: { orderId: 'order-paid-1' },
        status: 'processing',
        attempts: 1,
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockDb.select.mockImplementation(() => ({
        from: jest.fn().mockImplementation((table: any) => ({
          where: jest.fn().mockImplementation(() => {
            if (table === schema.orders) {
              return Promise.resolve([
                {
                  id: 'order-paid-1',
                  userId: 'user-c1',
                  shippingAddressId: 'addr-c1',
                  totalAmount: '2500.00',
                  paymentStatus: 'paid',
                  status: 'confirmed',
                  consignmentId: null,
                },
              ]);
            }
            if (table === schema.users) {
              return Promise.resolve([
                { id: 'user-c1', fullName: 'Alice Paid', phone: '01700000001' },
              ]);
            }
            if (table === schema.addresses) {
              return Promise.resolve([
                { id: 'addr-c1', addressLine1: 'Gulshan 2', city: 'Dhaka' },
              ]);
            }
            if (table === schema.orderItems) {
              return Promise.resolve([{ quantity: 1 }]);
            }
            return Promise.resolve([]);
          }),
        })),
      }));

      mockCourierService.createConsignment.mockResolvedValueOnce({
        success: true,
        consignmentId: 'SF-PAID-001',
        trackingUrl: 'https://steadfast.com.bd/t/SF-PAID-001',
      });

      const success = await processor.processEvent(event);

      expect(success).toBe(true);
      expect(mockCourierService.createConsignment).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: 'order-paid-1',
          amountToCollect: 0, // MUST BE ZERO for paid orders!
        }),
      );
    });

    it('CREATE_CONSIGNMENT: skips external API call if order status is cancelled or refunded', async () => {
      const event: schema.OutboxEvent = {
        id: 'evt-courier-cancelled',
        type: 'CREATE_CONSIGNMENT',
        payload: { orderId: 'order-cancelled-1' },
        status: 'processing',
        attempts: 1,
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockDb.select.mockImplementation(() => ({
        from: jest.fn().mockImplementation((table: any) => ({
          where: jest.fn().mockImplementation(() => {
            if (table === schema.orders) {
              return Promise.resolve([
                {
                  id: 'order-cancelled-1',
                  userId: 'user-c1',
                  shippingAddressId: 'addr-c1',
                  totalAmount: '1000.00',
                  paymentStatus: 'unpaid',
                  status: 'cancelled',
                  consignmentId: null,
                },
              ]);
            }
            return Promise.resolve([]);
          }),
        })),
      }));

      const success = await processor.processEvent(event);

      expect(success).toBe(true);
      expect(mockCourierService.createConsignment).not.toHaveBeenCalled();
    });

    it('CREATE_CONSIGNMENT: adopts existing consignment on retry (attempts > 1) if found at provider', async () => {
      const event: schema.OutboxEvent = {
        id: 'evt-courier-retry',
        type: 'CREATE_CONSIGNMENT',
        payload: { orderId: 'order-retry-1' },
        status: 'processing',
        attempts: 2, // Retried event!
        lastError: 'Connection reset',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockDb.select.mockImplementation(() => ({
        from: jest.fn().mockImplementation((table: any) => ({
          where: jest.fn().mockImplementation(() => {
            if (table === schema.orders) {
              return Promise.resolve([
                {
                  id: 'order-retry-1',
                  userId: 'user-c1',
                  shippingAddressId: 'addr-c1',
                  totalAmount: '1500.00',
                  paymentStatus: 'unpaid',
                  status: 'processing',
                  consignmentId: null,
                },
              ]);
            }
            if (table === schema.users) {
              return Promise.resolve([
                { id: 'user-c1', fullName: 'Bob Retry', phone: '01800000002' },
              ]);
            }
            if (table === schema.addresses) {
              return Promise.resolve([
                { id: 'addr-c1', addressLine1: 'Dhanmondi 32', city: 'Dhaka' },
              ]);
            }
            if (table === schema.orderItems) {
              return Promise.resolve([{ quantity: 1 }]);
            }
            return Promise.resolve([]);
          }),
        })),
      }));

      // Provider already has the consignment from previous crashed worker attempt
      mockCourierService.getConsignmentByInvoice.mockResolvedValueOnce({
        success: true,
        consignmentId: 'PREVIOUS-SF-CODE-123',
        trackingCode: 'PREVIOUS-SF-CODE-123',
        trackingUrl: 'https://steadfast.com.bd/t/PREVIOUS-SF-CODE-123',
      });

      const success = await processor.processEvent(event);

      expect(success).toBe(true);
      // createConsignment must NOT be called a second time!
      expect(mockCourierService.createConsignment).not.toHaveBeenCalled();
      // Order updated with adopted consignmentId
      expect(mockDb.update).toHaveBeenCalledWith(schema.orders);
    });

    it('SEND_SMS: throws error and triggers retry when smsService returns false', async () => {
      const event: schema.OutboxEvent = {
        id: 'evt-sms-fail',
        type: 'SEND_SMS',
        payload: {
          type: 'shipped',
          phone: '01712345678',
          orderId: 'order-sms-1',
          trackingUrl: 'https://steadfast.com.bd/t/SF-1',
        },
        status: 'processing',
        attempts: 1,
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockSmsService.sendOrderShippedSms.mockResolvedValueOnce(false);

      const success = await processor.processEvent(event);

      expect(success).toBe(false);
      // Resets to pending for next retry attempt
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'pending',
          lastError: expect.stringContaining('SMS delivery failed'),
        }),
      );
    });

    it('SEND_LOW_STOCK_ALERT: checks live stock and dispatches email when stock <= threshold', async () => {
      const event: schema.OutboxEvent = {
        id: 'evt-stock-1',
        type: 'SEND_LOW_STOCK_ALERT',
        payload: { productIds: ['prod-low-1', 'prod-high-2'] },
        status: 'processing',
        attempts: 1,
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      process.env.LOW_STOCK_THRESHOLD = '5';

      let callCount = 0;
      mockDb.select.mockImplementation(() => ({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockImplementation(() => {
            callCount++;
            if (callCount === 1) {
              return Promise.resolve([{ name: 'Lawn Shirt', stock: 2 }]);
            }
            return Promise.resolve([{ name: 'Jeans', stock: 15 }]);
          }),
        }),
      }));

      const success = await processor.processEvent(event);

      expect(success).toBe(true);
      expect(mockMailService.sendLowStockAlert).toHaveBeenCalledWith([
        { name: 'Lawn Shirt', stock: 2, threshold: 5 },
      ]);
    });
  });

  describe('processEvent - Provider Failure, Retries & Exhaustion', () => {
    it('handles transient Provider 500 error: resets status to pending when attempts < 3', async () => {
      const event: schema.OutboxEvent = {
        id: 'evt-retry-1',
        type: 'SEND_ORDER_CONFIRMATION',
        payload: {
          email: 'user@example.com',
          fullName: 'User',
          orderId: 'o1',
          items: [],
          totalAmount: '100',
        },
        status: 'processing',
        attempts: 1, // First attempt failed
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockMailService.sendOrderConfirmation.mockRejectedValueOnce(
        new Error('SMTP 500 Service Unavailable'),
      );

      const success = await processor.processEvent(event);

      expect(success).toBe(false);
      // Status reset to pending for retry
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'pending',
          lastError: 'SMTP 500 Service Unavailable',
        }),
      );
    });

    it('handles Provider 429 Rate Limit error: resets status to pending when attempts < 3', async () => {
      const event: schema.OutboxEvent = {
        id: 'evt-retry-2',
        type: 'SEND_SMS',
        payload: { type: 'shipped', phone: '01800000000', orderId: 'o2' },
        status: 'processing',
        attempts: 2, // Second attempt
        lastError: 'Previous error',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockSmsService.sendOrderShippedSms.mockRejectedValueOnce(
        new Error('HTTP 429 Too Many Requests'),
      );

      const success = await processor.processEvent(event);

      expect(success).toBe(false);
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'pending',
          lastError: 'HTTP 429 Too Many Requests',
        }),
      );
    });

    it('handles Provider Timeout error and permanently marks failed when attempts reaches MAX_ATTEMPTS (3)', async () => {
      const event: schema.OutboxEvent = {
        id: 'evt-exhaust-1',
        type: 'CREATE_CONSIGNMENT',
        payload: { orderId: 'ord-timeout' },
        status: 'processing',
        attempts: 3, // 3rd attempt
        lastError: 'Previous timeout',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockDb.select.mockImplementation(() => ({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([
            {
              id: 'ord-timeout',
              userId: 'u1',
              shippingAddressId: 'a1',
              totalAmount: '100',
              consignmentId: null,
            },
          ]),
        }),
      }));

      mockCourierService.createConsignment.mockRejectedValueOnce(
        new Error(
          'Steadfast Gateway ETIMEDOUT: Connection timed out after 10000ms',
        ),
      );

      const success = await processor.processEvent(event);

      expect(success).toBe(false);
      // Mark permanently failed
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          lastError:
            'Steadfast Gateway ETIMEDOUT: Connection timed out after 10000ms',
        }),
      );
    });

    it('marks permanently failed when event has unknown/unsupported type', async () => {
      const event: schema.OutboxEvent = {
        id: 'evt-unknown-1',
        type: 'UNSUPPORTED_DISPATCH_TYPE' as any,
        payload: {},
        status: 'processing',
        attempts: 1,
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const success = await processor.processEvent(event);

      expect(success).toBe(false);
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          lastError: 'Unknown event type: UNSUPPORTED_DISPATCH_TYPE',
        }),
      );
    });

    it('marks failed when order is not found in CREATE_CONSIGNMENT', async () => {
      const event: schema.OutboxEvent = {
        id: 'evt-missing-order',
        type: 'CREATE_CONSIGNMENT',
        payload: { orderId: 'non-existent-order' },
        status: 'processing',
        attempts: 3,
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockDb.select.mockImplementation(() => ({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([]),
        }),
      }));

      const success = await processor.processEvent(event);

      expect(success).toBe(false);
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          lastError: 'Order non-existent-order not found',
        }),
      );
    });
  });

  describe('processEvent - Refund and Reconciliation Events', () => {
    it('REFUND_REQUIRED: creates actionable refund record in schema.refunds with status requested', async () => {
      const event: schema.OutboxEvent = {
        id: 'evt-refund-1',
        type: 'REFUND_REQUIRED',
        payload: {
          orderId: 'order-ref-1',
          userId: 'user-ref-1',
          amount: '1200.00',
          reason: 'Order cancelled while paid',
        },
        status: 'processing',
        attempts: 1,
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockOrder = {
        id: 'order-ref-1',
        userId: 'user-ref-1',
        totalAmount: '1200.00',
      };

      let callCount = 0;
      mockDb.select.mockImplementation(() => ({
        from: jest.fn().mockImplementation((table) => {
          callCount++;
          if (callCount === 1) {
            // order lookup
            return {
              where: jest.fn().mockResolvedValue([mockOrder]),
            };
          } else if (callCount === 2) {
            // existing refund check -> none
            return {
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([]),
              }),
            };
          } else {
            // latest payment lookup
            return {
              where: jest.fn().mockReturnValue({
                orderBy: jest.fn().mockReturnValue({
                  limit: jest.fn().mockResolvedValue([{ id: 'pay-123' }]),
                }),
              }),
            };
          }
        }),
      }));

      const success = await processor.processEvent(event);

      expect(success).toBe(true);
      expect(mockDb.insert).toHaveBeenCalledWith(schema.refunds);
      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: 'order-ref-1',
          paymentId: 'pay-123',
          amount: '1200.00',
          status: 'requested',
          requestedBy: 'user-ref-1',
        }),
      );
    });

    it('REFUND_REQUIRED: skips duplicate insert if refund already registered for order', async () => {
      const event: schema.OutboxEvent = {
        id: 'evt-refund-dup',
        type: 'REFUND_REQUIRED',
        payload: {
          orderId: 'order-ref-dup',
          userId: 'user-ref-1',
          amount: '500.00',
        },
        status: 'processing',
        attempts: 1,
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      let callCount = 0;
      mockDb.select.mockImplementation(() => ({
        from: jest.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            return {
              where: jest.fn().mockResolvedValue([
                {
                  id: 'order-ref-dup',
                  userId: 'user-1',
                  totalAmount: '500.00',
                },
              ]),
            };
          } else {
            return {
              where: jest.fn().mockReturnValue({
                limit: jest
                  .fn()
                  .mockResolvedValue([{ id: 'existing-refund-id' }]),
              }),
            };
          }
        }),
      }));

      const success = await processor.processEvent(event);

      expect(success).toBe(true);
      expect(mockDb.insert).not.toHaveBeenCalledWith(schema.refunds);
    });

    it('RECONCILIATION_REQUIRED: creates actionable refund record with gateway transaction info', async () => {
      const event: schema.OutboxEvent = {
        id: 'evt-recon-1',
        type: 'RECONCILIATION_REQUIRED',
        payload: {
          orderId: 'order-recon-1',
          paymentId: 'pay-recon-1',
          transactionId: 'TRN_RECON_999',
          amount: '750.00',
          reason: 'Late payment confirmed after order was cancelled',
        },
        status: 'processing',
        attempts: 1,
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      let callCount = 0;
      mockDb.select.mockImplementation(() => ({
        from: jest.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            return {
              where: jest.fn().mockResolvedValue([
                {
                  id: 'order-recon-1',
                  userId: 'user-recon',
                  totalAmount: '750.00',
                },
              ]),
            };
          } else {
            return {
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([]),
              }),
            };
          }
        }),
      }));

      const success = await processor.processEvent(event);

      expect(success).toBe(true);
      expect(mockDb.insert).toHaveBeenCalledWith(schema.refunds);
      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: 'order-recon-1',
          paymentId: 'pay-recon-1',
          amount: '750.00',
          status: 'requested',
          adminNotes: expect.stringContaining('RECONCILIATION_REQUIRED'),
        }),
      );
    });

    it('SEND_ABANDONED_CART_EMAIL: checks active cart items and dispatches email via mailService', async () => {
      mockMailService.sendAbandonedCartEmail = jest
        .fn()
        .mockResolvedValue(undefined);

      const event: schema.OutboxEvent = {
        id: 'evt-abandoned-1',
        type: 'SEND_ABANDONED_CART_EMAIL',
        payload: {
          userId: 'user-abandoned-1',
          email: 'abandoned@gramoz.com',
          fullName: 'Abandoned Cart Customer',
          items: [
            {
              productName: 'Oxford Shirt (Size: L)',
              quantity: 2,
              unitPrice: '1500.00',
            },
          ],
        },
        status: 'processing',
        attempts: 1,
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Select returns active cart item
      mockDb.select.mockImplementation(() => ({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([{ id: 'cart-item-1' }]),
          }),
        }),
      }));

      const success = await processor.processEvent(event);

      expect(success).toBe(true);
      expect(mockMailService.sendAbandonedCartEmail).toHaveBeenCalledWith(
        'abandoned@gramoz.com',
        'Abandoned Cart Customer',
        [
          {
            productName: 'Oxford Shirt (Size: L)',
            quantity: 2,
            unitPrice: '1500.00',
          },
        ],
      );
    });

    it('SEND_ABANDONED_CART_EMAIL: skips email dispatch if cart was emptied or checked out (CONC-19-J)', async () => {
      mockMailService.sendAbandonedCartEmail = jest
        .fn()
        .mockResolvedValue(undefined);

      const event: schema.OutboxEvent = {
        id: 'evt-abandoned-2',
        type: 'SEND_ABANDONED_CART_EMAIL',
        payload: {
          userId: 'user-abandoned-checkedout',
          email: 'checkedout@gramoz.com',
          fullName: 'Checked Out Customer',
          items: [
            { productName: 'Polo Tee', quantity: 1, unitPrice: '800.00' },
          ],
        },
        status: 'processing',
        attempts: 1,
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Select returns empty array (cart items already deleted during checkout)
      mockDb.select.mockImplementation(() => ({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      }));

      const success = await processor.processEvent(event);

      expect(success).toBe(true);
      expect(mockMailService.sendAbandonedCartEmail).not.toHaveBeenCalled();
    });
  });
});
