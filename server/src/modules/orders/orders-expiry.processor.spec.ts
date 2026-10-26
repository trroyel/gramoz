import { OrdersExpiryProcessor } from './orders-expiry.processor';
import { OrdersStore } from './orders.store';
import { OrdersService } from './orders.service';
import { SettingsService } from '../settings/settings.service';

describe('OrdersExpiryProcessor', () => {
  let processor: OrdersExpiryProcessor;
  let mockStore: { findStaleUnpaidOrdersForExpiry: jest.Mock };
  let mockOrdersService: { expireOrder: jest.Mock };
  let mockSettingsService: { getCheckoutExpiryMinutes: jest.Mock };

  beforeEach(() => {
    mockStore = {
      findStaleUnpaidOrdersForExpiry: jest.fn(),
    };
    mockOrdersService = {
      expireOrder: jest.fn(),
    };
    mockSettingsService = {
      getCheckoutExpiryMinutes: jest.fn().mockResolvedValue(30),
    };

    processor = new OrdersExpiryProcessor(
      mockStore as unknown as OrdersStore,
      mockOrdersService as unknown as OrdersService,
      mockSettingsService as unknown as SettingsService,
    );
  });

  it('scans for stale orders with configured threshold and expires each order', async () => {
    mockSettingsService.getCheckoutExpiryMinutes.mockResolvedValue(45);
    mockStore.findStaleUnpaidOrdersForExpiry.mockResolvedValue([
      { id: 'order-1' },
      { id: 'order-2' },
    ]);
    mockOrdersService.expireOrder.mockResolvedValue({
      id: 'order-1',
      status: 'cancelled',
    });

    const count = await processor.processStaleCheckoutExpiry();

    expect(mockSettingsService.getCheckoutExpiryMinutes).toHaveBeenCalled();
    expect(mockStore.findStaleUnpaidOrdersForExpiry).toHaveBeenCalledWith(45);
    expect(mockOrdersService.expireOrder).toHaveBeenCalledTimes(2);
    expect(mockOrdersService.expireOrder).toHaveBeenCalledWith(
      'order-1',
      expect.stringContaining('Automated checkout expiry (unpaid after 45m)'),
    );
    expect(mockOrdersService.expireOrder).toHaveBeenCalledWith(
      'order-2',
      expect.stringContaining('Automated checkout expiry (unpaid after 45m)'),
    );
    expect(count).toBe(2);
  });

  it('gracefully exits with 0 when no stale orders are found', async () => {
    mockStore.findStaleUnpaidOrdersForExpiry.mockResolvedValue([]);

    const count = await processor.processStaleCheckoutExpiry();

    expect(count).toBe(0);
    expect(mockOrdersService.expireOrder).not.toHaveBeenCalled();
  });

  it('continues expiring subsequent orders even if one order fails', async () => {
    mockStore.findStaleUnpaidOrdersForExpiry.mockResolvedValue([
      { id: 'order-fail' },
      { id: 'order-success' },
    ]);
    mockOrdersService.expireOrder
      .mockRejectedValueOnce(new Error('Lock acquisition timeout'))
      .mockResolvedValueOnce({ id: 'order-success', status: 'cancelled' });

    const count = await processor.processStaleCheckoutExpiry();

    expect(mockOrdersService.expireOrder).toHaveBeenCalledTimes(2);
    expect(count).toBe(1); // One succeeded
  });

  it('handles unexpected store query exceptions gracefully without crashing worker', async () => {
    mockStore.findStaleUnpaidOrdersForExpiry.mockRejectedValue(
      new Error('Database connectivity error'),
    );

    const count = await processor.processStaleCheckoutExpiry();

    expect(count).toBe(0);
  });
});
