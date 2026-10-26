import { Test, TestingModule } from '@nestjs/testing';
import { PromosService } from './promos.service';
import { DATABASE } from '@database/database.module';
import {
  EntityNotFoundError,
  EntityConflictError,
  InvalidOperationError,
} from '../../common/errors/domain.errors';

describe('PromosService', () => {
  let service: PromosService;
  let mockDb: any;

  beforeEach(async () => {
    mockDb = {
      query: {
        promos: {
          findFirst: jest.fn(),
          findMany: jest.fn(),
        },
      },
      insert: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      select: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PromosService,
        {
          provide: DATABASE,
          useValue: mockDb,
        },
      ],
    }).compile();

    service = module.get<PromosService>(PromosService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('creates a percentage promo with uppercased code', async () => {
      mockDb.query.promos.findFirst.mockResolvedValue(null);
      const inserted = {
        id: 'promo-1',
        code: 'SUMMER20',
        discountType: 'percentage',
        discountValue: '20.00',
        minOrderValue: '500.00',
        maxUses: 100,
        currentUses: 0,
        expiresAt: new Date(Date.now() + 86400000),
        isActive: true,
      };

      const returningMock = jest.fn().mockResolvedValue([inserted]);
      const valuesMock = jest
        .fn()
        .mockReturnValue({ returning: returningMock });
      mockDb.insert.mockReturnValue({ values: valuesMock });

      const result = await service.create({
        code: 'summer20',
        discountType: 'percentage',
        discountValue: 20,
        minOrderValue: 500,
        maxUses: 100,
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      });

      expect(mockDb.query.promos.findFirst).toHaveBeenCalled();
      expect(mockDb.insert).toHaveBeenCalled();
      expect(valuesMock).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'SUMMER20',
          discountType: 'percentage',
          discountValue: '20',
        }),
      );
      expect(result).toEqual(inserted);
    });

    it('rejects duplicate promo code with EntityConflictError', async () => {
      mockDb.query.promos.findFirst.mockResolvedValue({ id: 'existing-id' });

      await expect(
        service.create({
          code: 'DUPLICATE',
          discountType: 'fixed',
          discountValue: 50,
        }),
      ).rejects.toThrow(EntityConflictError);
    });

    it('rejects discountValue <= 0 with InvalidOperationError', async () => {
      await expect(
        service.create({
          code: 'ZERO',
          discountType: 'fixed',
          discountValue: 0,
        }),
      ).rejects.toThrow(InvalidOperationError);

      await expect(
        service.create({
          code: 'NEGATIVE',
          discountType: 'fixed',
          discountValue: -10,
        }),
      ).rejects.toThrow(InvalidOperationError);
    });

    it('rejects percentage discount > 100% with InvalidOperationError', async () => {
      await expect(
        service.create({
          code: 'OVER100',
          discountType: 'percentage',
          discountValue: 120,
        }),
      ).rejects.toThrow(InvalidOperationError);
    });

    it('rejects negative minOrderValue with InvalidOperationError', async () => {
      await expect(
        service.create({
          code: 'NEGMIN',
          discountType: 'fixed',
          discountValue: 50,
          minOrderValue: -100,
        }),
      ).rejects.toThrow(InvalidOperationError);
    });

    it('rejects maxUses < 1 with InvalidOperationError', async () => {
      await expect(
        service.create({
          code: 'ZEROUSES',
          discountType: 'fixed',
          discountValue: 50,
          maxUses: 0,
        }),
      ).rejects.toThrow(InvalidOperationError);
    });
  });

  describe('findAll', () => {
    it('returns all promos from database', async () => {
      const promoList = [
        { id: 'p1', code: 'PROMO1' },
        { id: 'p2', code: 'PROMO2' },
      ];
      mockDb.query.promos.findMany.mockResolvedValue(promoList);

      const result = await service.findAll();
      expect(result).toEqual(promoList);
      expect(mockDb.query.promos.findMany).toHaveBeenCalled();
    });
  });

  describe('findPublicActive', () => {
    it('queries active, non-expired, and non-exhausted promos pushed to DB', async () => {
      const activePromos = [{ id: 'p1', code: 'ACTIVE10' }];
      const orderByMock = jest.fn().mockResolvedValue(activePromos);
      const whereMock = jest.fn().mockReturnValue({ orderBy: orderByMock });
      const fromMock = jest.fn().mockReturnValue({ where: whereMock });
      mockDb.select.mockReturnValue({ from: fromMock });

      const result = await service.findPublicActive();
      expect(result).toEqual(activePromos);
      expect(mockDb.select).toHaveBeenCalled();
      expect(fromMock).toHaveBeenCalled();
      expect(whereMock).toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('returns promo when found', async () => {
      const promo = { id: 'p1', code: 'FOUND' };
      mockDb.query.promos.findFirst.mockResolvedValue(promo);

      const result = await service.findOne('p1');
      expect(result).toEqual(promo);
    });

    it('throws EntityNotFoundError when promo does not exist', async () => {
      mockDb.query.promos.findFirst.mockResolvedValue(null);

      await expect(service.findOne('non-existent')).rejects.toThrow(
        EntityNotFoundError,
      );
    });
  });

  describe('toggleActive', () => {
    it('flips isActive boolean in database', async () => {
      const existing = { id: 'p1', isActive: true };
      mockDb.query.promos.findFirst.mockResolvedValue(existing);

      const returningMock = jest
        .fn()
        .mockResolvedValue([{ id: 'p1', isActive: false }]);
      const whereMock = jest.fn().mockReturnValue({ returning: returningMock });
      const setMock = jest.fn().mockReturnValue({ where: whereMock });
      mockDb.update.mockReturnValue({ set: setMock });

      const result = await service.toggleActive('p1');
      expect(result.isActive).toBe(false);
      expect(setMock).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: false }),
      );
    });
  });

  describe('delete', () => {
    it('deletes promo and returns deleted row', async () => {
      const returningMock = jest.fn().mockResolvedValue([{ id: 'p1' }]);
      const whereMock = jest.fn().mockReturnValue({ returning: returningMock });
      mockDb.delete.mockReturnValue({ where: whereMock });

      const result = await service.delete('p1');
      expect(result).toEqual({ id: 'p1' });
    });

    it('throws EntityNotFoundError if promo not found on delete', async () => {
      const returningMock = jest.fn().mockResolvedValue([]);
      const whereMock = jest.fn().mockReturnValue({ returning: returningMock });
      mockDb.delete.mockReturnValue({ where: whereMock });

      await expect(service.delete('p1')).rejects.toThrow(EntityNotFoundError);
    });
  });

  describe('validate', () => {
    it('validates percentage promo and computes correct discount amount', async () => {
      mockDb.query.promos.findFirst.mockResolvedValue({
        id: 'promo-percent',
        code: 'SAVE20',
        discountType: 'percentage',
        discountValue: '20.00',
        minOrderValue: '100.00',
        maxUses: 100,
        currentUses: 5,
        expiresAt: new Date(Date.now() + 86400000),
        isActive: true,
      });

      const result = await service.validate({
        code: 'save20',
        subtotal: 500,
      });

      expect(result).toEqual({
        promoId: 'promo-percent',
        code: 'SAVE20',
        discountType: 'percentage',
        discountValue: 20,
        discountAmount: 100, // 20% of 500 = 100
      });
    });

    it('validates fixed promo and computes correct discount amount', async () => {
      mockDb.query.promos.findFirst.mockResolvedValue({
        id: 'promo-fixed',
        code: 'FLAT50',
        discountType: 'fixed',
        discountValue: '50.00',
        minOrderValue: '200.00',
        maxUses: 50,
        currentUses: 10,
        expiresAt: null,
        isActive: true,
      });

      const result = await service.validate({
        code: 'FLAT50',
        subtotal: 300,
      });

      expect(result.discountAmount).toBe(50);
      expect(result.discountType).toBe('fixed');
    });

    it('caps fixed discount so it never exceeds subtotal', async () => {
      mockDb.query.promos.findFirst.mockResolvedValue({
        id: 'promo-fixed-large',
        code: 'BIGDISCOUNT',
        discountType: 'fixed',
        discountValue: '500.00',
        minOrderValue: null,
        maxUses: null,
        currentUses: 0,
        expiresAt: null,
        isActive: true,
      });

      const result = await service.validate({
        code: 'BIGDISCOUNT',
        subtotal: 200,
      });

      expect(result.discountAmount).toBe(200); // Capped at subtotal, not 500
    });

    it('handles exact decimal cents rounding for fractional percentages', async () => {
      mockDb.query.promos.findFirst.mockResolvedValue({
        id: 'promo-fraction',
        code: 'FRACTION15',
        discountType: 'percentage',
        discountValue: '15.00',
        minOrderValue: null,
        maxUses: null,
        currentUses: 0,
        expiresAt: null,
        isActive: true,
      });

      // 15% of 99.99 = 14.9985 -> rounded to 15.00 in cents
      const result = await service.validate({
        code: 'FRACTION15',
        subtotal: 99.99,
      });

      expect(result.discountAmount).toBe(15);
    });

    it('rejects non-existent promo code with EntityNotFoundError', async () => {
      mockDb.query.promos.findFirst.mockResolvedValue(null);

      await expect(
        service.validate({ code: 'INVALID', subtotal: 100 }),
      ).rejects.toThrow(EntityNotFoundError);
    });

    it('rejects inactive promo code with InvalidOperationError', async () => {
      mockDb.query.promos.findFirst.mockResolvedValue({
        id: 'p-inactive',
        code: 'INACTIVE',
        isActive: false,
      });

      await expect(
        service.validate({ code: 'INACTIVE', subtotal: 100 }),
      ).rejects.toThrow(InvalidOperationError);
    });

    it('rejects expired promo code with InvalidOperationError', async () => {
      mockDb.query.promos.findFirst.mockResolvedValue({
        id: 'p-expired',
        code: 'EXPIRED',
        isActive: true,
        expiresAt: new Date(Date.now() - 10000), // Expired 10s ago
      });

      await expect(
        service.validate({ code: 'EXPIRED', subtotal: 100 }),
      ).rejects.toThrow('This promo code has expired');
    });

    it('rejects exhausted promo code when currentUses >= maxUses', async () => {
      mockDb.query.promos.findFirst.mockResolvedValue({
        id: 'p-exhausted',
        code: 'EXHAUSTED',
        isActive: true,
        maxUses: 10,
        currentUses: 10,
      });

      await expect(
        service.validate({ code: 'EXHAUSTED', subtotal: 100 }),
      ).rejects.toThrow('This promo code has reached its maximum usage limit');
    });

    it('rejects when subtotal is below minOrderValue', async () => {
      mockDb.query.promos.findFirst.mockResolvedValue({
        id: 'p-min',
        code: 'MINORDER',
        isActive: true,
        minOrderValue: '1000.00',
        maxUses: 100,
        currentUses: 0,
      });

      await expect(
        service.validate({ code: 'MINORDER', subtotal: 500 }),
      ).rejects.toThrow(
        'This promo requires a minimum order value of 1000.00 ৳',
      );
    });
  });
});
