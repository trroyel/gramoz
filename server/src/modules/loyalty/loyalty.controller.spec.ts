import { Test, TestingModule } from '@nestjs/testing';
import { LoyaltyController } from './loyalty.controller';
import { LoyaltyService } from './loyalty.service';
import { SettingsService } from '../settings/settings.service';

describe('LoyaltyController', () => {
  let controller: LoyaltyController;
  let mockLoyaltyService: any;
  let mockSettingsService: any;

  beforeEach(async () => {
    mockLoyaltyService = {
      getBalance: jest.fn(),
      getHistory: jest.fn(),
    };

    mockSettingsService = {
      getPointsToCurrencyRatio: jest.fn().mockResolvedValue(100),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [LoyaltyController],
      providers: [
        {
          provide: LoyaltyService,
          useValue: mockLoyaltyService,
        },
        {
          provide: SettingsService,
          useValue: mockSettingsService,
        },
      ],
    }).compile();

    controller = module.get<LoyaltyController>(LoyaltyController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getMyBalance', () => {
    it('returns balance, currencyValue, and ratio for authenticated user', async () => {
      mockLoyaltyService.getBalance.mockResolvedValue(250);
      mockSettingsService.getPointsToCurrencyRatio.mockResolvedValue(100);

      const req = { user: { id: 'u1' } };
      const response = await controller.getMyBalance(req);

      expect(mockLoyaltyService.getBalance).toHaveBeenCalledWith('u1');
      expect(mockSettingsService.getPointsToCurrencyRatio).toHaveBeenCalled();
      expect(response).toEqual({
        success: true,
        data: {
          balance: 250,
          currencyValue: 2.5, // 250 / 100
          ratio: 100,
        },
      });
    });

    it('returns 0 currency value when balance is 0', async () => {
      mockLoyaltyService.getBalance.mockResolvedValue(0);
      mockSettingsService.getPointsToCurrencyRatio.mockResolvedValue(100);

      const req = { user: { id: 'u1' } };
      const response = await controller.getMyBalance(req);

      expect(response.data.balance).toBe(0);
      expect(response.data.currencyValue).toBe(0);
    });
  });

  describe('getMyHistory', () => {
    it('returns transaction history with sanitized page number', async () => {
      const history = [{ id: 'tx-1', points: 50 }];
      mockLoyaltyService.getHistory.mockResolvedValue(history);

      const req = { user: { id: 'u1' } };
      const response = await controller.getMyHistory(req, '3');

      expect(mockLoyaltyService.getHistory).toHaveBeenCalledWith('u1', 3);
      expect(response).toEqual({ success: true, data: history });
    });

    it('defaults to page 1 when query is missing or invalid', async () => {
      mockLoyaltyService.getHistory.mockResolvedValue([]);

      const req = { user: { id: 'u1' } };
      await controller.getMyHistory(req, 'invalid');
      expect(mockLoyaltyService.getHistory).toHaveBeenCalledWith('u1', 1);

      await controller.getMyHistory(req, '-5');
      expect(mockLoyaltyService.getHistory).toHaveBeenCalledWith('u1', 1);
    });
  });

  describe('Authorization Metadata', () => {
    it('has customer, admin, and super_admin roles configured on controller endpoints', () => {
      const balanceRoles = Reflect.getMetadata(
        'roles',
        LoyaltyController.prototype.getMyBalance,
      );
      expect(balanceRoles).toEqual(['customer', 'admin', 'super_admin']);

      const historyRoles = Reflect.getMetadata(
        'roles',
        LoyaltyController.prototype.getMyHistory,
      );
      expect(historyRoles).toEqual(['customer', 'admin', 'super_admin']);
    });
  });
});
