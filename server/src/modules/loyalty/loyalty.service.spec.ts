import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { LoyaltyService } from './loyalty.service';
import { LoyaltyStore } from './loyalty.store';
import { SettingsService } from '../settings/settings.service';

describe('LoyaltyService', () => {
  let service: LoyaltyService;
  let mockStore: any;
  let mockSettings: any;

  beforeEach(async () => {
    mockStore = {
      lockUserForLoyalty: jest.fn().mockResolvedValue(undefined),
      createTransaction: jest.fn(),
      getAvailableBalance: jest.fn(),
      getTransactionHistory: jest.fn(),
      hasPointsBeenRefunded: jest.fn().mockResolvedValue(false),
      hasPointsBeenAwarded: jest.fn().mockResolvedValue(false),
    };

    mockSettings = {
      getPointsValidityDays: jest.fn().mockResolvedValue(365),
      getPointsToCurrencyRatio: jest.fn().mockResolvedValue(100),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoyaltyService,
        {
          provide: LoyaltyStore,
          useValue: mockStore,
        },
        {
          provide: SettingsService,
          useValue: mockSettings,
        },
      ],
    }).compile();

    service = module.get<LoyaltyService>(LoyaltyService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('awardPoints', () => {
    it('awards positive points with computed validUntil date', async () => {
      const createdTx = {
        id: 'tx-1',
        userId: 'u1',
        points: 50,
        type: 'earned_review_text',
        referenceId: 'rev-1',
      };
      mockStore.createTransaction.mockResolvedValue(createdTx);

      const result = await service.awardPoints(
        'u1',
        50,
        'earned_review_text',
        'rev-1',
      );

      expect(mockSettings.getPointsValidityDays).toHaveBeenCalled();
      expect(mockStore.createTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u1',
          points: 50,
          type: 'earned_review_text',
          referenceId: 'rev-1',
          validUntil: expect.any(Date),
        }),
        undefined,
      );
      expect(result).toEqual(createdTx);
    });

    it('returns null and skips awarding points if points have already been awarded for referenceId', async () => {
      mockStore.hasPointsBeenAwarded.mockResolvedValue(true);

      const result = await service.awardPoints(
        'u1',
        50,
        'earned_review_text',
        'rev-1',
      );

      expect(mockStore.hasPointsBeenAwarded).toHaveBeenCalledWith(
        'rev-1',
        'earned_review_text',
        undefined,
      );
      expect(mockStore.createTransaction).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('rejects awarding points <= 0 with BadRequestException', async () => {
      await expect(
        service.awardPoints('u1', 0, 'earned_review_text'),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.awardPoints('u1', -10, 'earned_review_text'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('spendPoints', () => {
    it('acquires user row lock and deducts points when balance is sufficient', async () => {
      mockStore.getAvailableBalance.mockResolvedValue(200);
      const spentTx = {
        id: 'tx-spent',
        userId: 'u1',
        points: -80,
        type: 'spent_checkout',
        referenceId: 'order-1',
      };
      mockStore.createTransaction.mockResolvedValue(spentTx);

      const mockTx = { isTx: true };
      const result = await service.spendPoints('u1', 80, 'order-1', mockTx);

      expect(mockStore.lockUserForLoyalty).toHaveBeenCalledWith('u1', mockTx);
      expect(mockStore.getAvailableBalance).toHaveBeenCalledWith('u1', mockTx);
      expect(mockStore.createTransaction).toHaveBeenCalledWith(
        {
          userId: 'u1',
          points: -80,
          type: 'spent_checkout',
          referenceId: 'order-1',
          validUntil: null,
        },
        mockTx,
      );
      expect(result).toEqual(spentTx);
    });

    it('rejects pointsToSpend <= 0 with BadRequestException', async () => {
      await expect(service.spendPoints('u1', 0)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.spendPoints('u1', -50)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects deduction when balance is insufficient', async () => {
      mockStore.getAvailableBalance.mockResolvedValue(50);

      await expect(service.spendPoints('u1', 100)).rejects.toThrow(
        'Insufficient points balance. Available: 50',
      );
      expect(mockStore.createTransaction).not.toHaveBeenCalled();
    });
  });

  describe('refundPoints', () => {
    it('restores spent points as admin_adjustment with referenceId', async () => {
      const refundTx = {
        id: 'tx-refund',
        userId: 'u1',
        points: 80,
        type: 'admin_adjustment',
        referenceId: 'order-1',
      };
      mockStore.createTransaction.mockResolvedValue(refundTx);

      const mockTx = { isTx: true };
      const result = await service.refundPoints('u1', 80, 'order-1', mockTx);

      expect(mockStore.hasPointsBeenRefunded).toHaveBeenCalledWith(
        'order-1',
        mockTx,
      );
      expect(mockStore.createTransaction).toHaveBeenCalledWith(
        {
          userId: 'u1',
          points: 80,
          type: 'admin_adjustment',
          referenceId: 'order-1',
          validUntil: null,
        },
        mockTx,
      );
      expect(result).toEqual(refundTx);
    });

    it('guards against duplicate point restoration for the same referenceId', async () => {
      mockStore.hasPointsBeenRefunded.mockResolvedValue(true);

      const result = await service.refundPoints('u1', 80, 'order-1');
      expect(result).toBeUndefined();
      expect(mockStore.createTransaction).not.toHaveBeenCalled();
    });

    it('ignores refund if pointsToRefund <= 0', async () => {
      const result = await service.refundPoints('u1', 0);
      expect(result).toBeUndefined();
      expect(mockStore.createTransaction).not.toHaveBeenCalled();
    });
  });

  describe('getBalance', () => {
    it('delegates to store getAvailableBalance', async () => {
      mockStore.getAvailableBalance.mockResolvedValue(150);

      const balance = await service.getBalance('u1');
      expect(balance).toBe(150);
      expect(mockStore.getAvailableBalance).toHaveBeenCalledWith('u1');
    });
  });

  describe('getHistory', () => {
    it('calculates correct offset and retrieves transaction history', async () => {
      const history = [{ id: 'tx-1', points: 50 }];
      mockStore.getTransactionHistory.mockResolvedValue(history);

      const result = await service.getHistory('u1', 2, 10);
      expect(result).toEqual(history);
      expect(mockStore.getTransactionHistory).toHaveBeenCalledWith(
        'u1',
        10,
        10,
      );
    });

    it('handles negative or invalid page gracefully', async () => {
      mockStore.getTransactionHistory.mockResolvedValue([]);

      await service.getHistory('u1', -5, 20);
      expect(mockStore.getTransactionHistory).toHaveBeenCalledWith('u1', 20, 0);
    });
  });
});
