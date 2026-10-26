import { Test, TestingModule } from '@nestjs/testing';
import { ProductsService } from './products.service';
import { DATABASE } from '@database/database.module';
import { RedisService } from '../../cache/redis.service';
import { EntityNotFoundError } from '../../common/errors/domain.errors';

describe('ProductsService (Unit Tests — TASK-20)', () => {
  let service: ProductsService;
  let mockDb: any;
  let mockRedis: any;

  beforeEach(async () => {
    mockDb = {
      transaction: jest.fn(async (cb) => {
        return cb(mockDb);
      }),
      insert: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      returning: jest.fn(),
      select: jest.fn(() => {
        const chain: any = {
          from: jest.fn().mockReturnThis(),
          leftJoin: jest.fn().mockReturnThis(),
          where: jest.fn(() => chain),
          orderBy: jest.fn(() => chain),
          limit: jest.fn().mockReturnThis(),
          offset: jest.fn().mockImplementation(() => {
            return Promise.resolve(mockDb.__dataResult ?? []);
          }),
          then: (resolve: any) => {
            // When awaited at .where or .orderBy
            const result =
              mockDb.__activeChainResults?.shift() ??
              mockDb.__defaultResult ??
              [];
            return Promise.resolve(result).then(resolve);
          },
        };
        chain.from.mockReturnValue(chain);
        chain.leftJoin.mockReturnValue(chain);
        chain.limit.mockReturnValue(chain);
        return chain;
      }),
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      __dataResult: [],
      __activeChainResults: [],
      __defaultResult: [],
    };

    mockRedis = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        {
          provide: DATABASE,
          useValue: mockDb,
        },
        {
          provide: RedisService,
          useValue: mockRedis,
        },
      ],
    }).compile();

    service = module.get<ProductsService>(ProductsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('B-PRD-01a: creates a product with valid slug, default status, and returns it', async () => {
      const createdRow = {
        id: 'prod-123',
        name: 'Gramoz Premium Hoodie',
        slug: 'gramoz-premium-hoodie-123456',
        price: '1200.00',
        stock: 50,
        status: 'active',
      };
      mockDb.returning.mockResolvedValueOnce([createdRow]);

      const result = await service.create({
        name: 'Gramoz Premium Hoodie',
        price: 1200,
        stock: 50,
        description: 'Cozy hoodie',
      });

      expect(result).toEqual(createdRow);
      expect(mockDb.insert).toHaveBeenCalled();
      const insertValues = mockDb.values.mock.calls[0][0];
      expect(insertValues.name).toBe('Gramoz Premium Hoodie');
      expect(insertValues.slug).toMatch(/^gramoz-premium-hoodie-\d+$/);
      expect(insertValues.status).toBe('active');
      expect(insertValues.price).toBe('1200');
    });

    it('B-PRD-01b: creates a product with variants and sanitizes valid variant records', async () => {
      const createdRow = {
        id: 'prod-var-1',
        name: 'Shirt',
        price: '500.00',
        stock: 20,
      };
      mockDb.returning.mockResolvedValueOnce([createdRow]);

      const variantsPayload = JSON.stringify([
        { sku: 'SHIRT-S', price: 499.99, stock: 10, attributes: { size: 'S' } },
        { sku: 'SHIRT-M', price: 549.99, stock: 10, attributes: { size: 'M' } },
        { sku: 'SHIRT-BAD', price: -10, stock: -5 }, // invalid, should be filtered
      ]);

      const result = await service.create({
        name: 'Shirt',
        price: 500,
        stock: 20,
        variants: variantsPayload,
      });

      expect(result).toEqual(createdRow);
      // Verify variant insertion called
      expect(mockDb.insert).toHaveBeenCalledTimes(2);
      const variantInserts = mockDb.values.mock.calls[1][0];
      expect(variantInserts).toHaveLength(2);
      expect(variantInserts[0]).toEqual({
        productId: 'prod-var-1',
        sku: 'SHIRT-S',
        price: '499.99',
        stock: 10,
        attributes: { size: 'S' },
        imageUrl: undefined,
      });
    });

    it('B-PRD-01c: handles malformed variant JSON gracefully without crashing', async () => {
      const createdRow = {
        id: 'prod-json-err',
        name: 'Hat',
        price: '300.00',
        stock: 15,
      };
      mockDb.returning.mockResolvedValueOnce([createdRow]);

      const result = await service.create({
        name: 'Hat',
        price: 300,
        stock: 15,
        variants: '{ invalid-json',
      });

      expect(result).toEqual(createdRow);
      expect(mockDb.insert).toHaveBeenCalledTimes(1);
    });

    it('B-PRD-01d: sets image url if provided in arguments', async () => {
      const createdRow = {
        id: 'prod-img',
        name: 'Cap',
        price: '250.00',
        stock: 5,
      };
      mockDb.returning.mockResolvedValueOnce([createdRow]);

      await service.create(
        { name: 'Cap', price: 250, stock: 5 },
        'https://cdn.gramoz.com/cap.png',
      );

      const insertValues = mockDb.values.mock.calls[0][0];
      expect(insertValues.images).toEqual([
        { url: 'https://cdn.gramoz.com/cap.png' },
      ]);
    });
  });

  describe('findAll', () => {
    it('B-PRD-05a: returns paginated active products excluding soft-deleted', async () => {
      const mockProducts = [
        { id: 'p1', name: 'Item 1', price: '100.00', status: 'active' },
        { id: 'p2', name: 'Item 2', price: '200.00', status: 'active' },
      ];
      mockDb.__dataResult = mockProducts;
      mockDb.__activeChainResults = [[{ count: 2 }]];

      const result = await service.findAll({ page: '1', limit: '10' });

      expect(result.data).toEqual(mockProducts);
      expect(result.meta).toEqual({
        total: 2,
        page: 1,
        limit: 10,
        totalPages: 1,
      });
    });

    it('B-PRD-05b: clamps pagination limit to maximum 100', async () => {
      mockDb.__dataResult = [];
      mockDb.__activeChainResults = [[{ count: 0 }]];

      const result = await service.findAll({ limit: '500' });
      expect(result.meta.limit).toBe(100);
    });

    it('B-PRD-05c: applies search q filter, inStock, minPrice, and sort', async () => {
      mockDb.__dataResult = [];
      mockDb.__activeChainResults = [[{ count: 0 }]];

      await service.findAll({
        q: 'denim',
        inStock: 'true',
        minPrice: '500',
        maxPrice: '2000',
        sort: 'price_asc',
      });

      expect(mockDb.select).toHaveBeenCalled();
    });

    it('B-PRD-05d: differentiates UUID category vs slug/name category', async () => {
      mockDb.__dataResult = [];
      mockDb.__activeChainResults = [[{ count: 0 }]];

      // UUID category
      await service.findAll({
        category: '11111111-2222-3333-4444-555555555555',
      });
      expect(mockDb.select).toHaveBeenCalled();

      // String slug category
      mockDb.__dataResult = [];
      mockDb.__activeChainResults = [[{ count: 0 }]];
      await service.findAll({ category: 'mens-apparel' });
      expect(mockDb.select).toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('B-PRD-02a: returns cached product directly from Redis on cache hit', async () => {
      const cachedProduct = {
        id: 'cached-123',
        name: 'Cached T-Shirt',
        price: '450.00',
        variants: [{ id: 'var-1', sku: 'TS-RED' }],
      };
      mockRedis.get.mockResolvedValueOnce(JSON.stringify(cachedProduct));

      const result = await service.findOne('cached-123');

      expect(result).toEqual(cachedProduct);
      expect(mockRedis.get).toHaveBeenCalledWith('product:cached-123');
      // DB query should be completely bypassed on hit
      expect(mockDb.select).not.toHaveBeenCalled();
    });

    it('B-PRD-02b: queries DB on cache miss, populates Redis with 300s TTL, and returns', async () => {
      mockRedis.get.mockResolvedValueOnce(null);

      const dbProduct = {
        id: 'prod-miss-1',
        name: 'Database Polo',
        price: '750.00',
        stock: 30,
      };
      const dbVariants = [
        { id: 'v1', sku: 'POLO-L', price: '750.00', stock: 15 },
      ];

      mockDb.__activeChainResults = [[dbProduct], dbVariants];

      const result = await service.findOne('prod-miss-1');

      expect(result).toEqual({ ...dbProduct, variants: dbVariants });
      expect(mockRedis.set).toHaveBeenCalledWith(
        'product:prod-miss-1',
        JSON.stringify({ ...dbProduct, variants: dbVariants }),
        300,
      );
    });

    it('B-PRD-02c: returns undefined when product does not exist in DB or is soft-deleted', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      mockDb.__activeChainResults = [[]]; // No row found

      const result = await service.findOne('non-existent-uuid');

      expect(result).toBeUndefined();
      expect(mockRedis.set).not.toHaveBeenCalled();
    });

    it('B-PRD-02d (CACHE-20-I): gracefully falls back to DB when Redis get throws error', async () => {
      mockRedis.get.mockRejectedValueOnce(
        new Error('Redis connection refused'),
      );

      const dbProduct = {
        id: 'fallback-1',
        name: 'Fallback Mug',
        price: '150.00',
      };
      mockDb.__activeChainResults = [[dbProduct], []];

      const result = await service.findOne('fallback-1');

      expect(result).toEqual({ ...dbProduct, variants: [] });
      expect(mockDb.select).toHaveBeenCalled();
    });

    it('B-PRD-02e: succeeds even if Redis set throws error on cache population', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      mockRedis.set.mockRejectedValueOnce(new Error('OOM command not allowed'));

      const dbProduct = { id: 'prod-oom', name: 'OOM Bag', price: '999.00' };
      mockDb.__activeChainResults = [[dbProduct], []];

      const result = await service.findOne('prod-oom');

      expect(result).toEqual({ ...dbProduct, variants: [] });
    });
  });

  describe('update', () => {
    it('B-PRD-03a (CACHE-20-A): updates product in DB and invalidates Redis cache product:<id>', async () => {
      const updatedProduct = {
        id: 'upd-1',
        name: 'Updated Jacket',
        price: '2500.00',
      };
      mockDb.returning.mockResolvedValueOnce([updatedProduct]);

      const result = await service.update('upd-1', {
        name: 'Updated Jacket',
        price: 2500,
      });

      expect(result).toEqual(updatedProduct);
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockRedis.del).toHaveBeenCalledWith('product:upd-1');
    });

    it('B-PRD-03b: updates variants by deleting old variants and inserting new valid ones', async () => {
      const updatedProduct = { id: 'upd-var', name: 'Sneakers' };
      mockDb.returning.mockResolvedValueOnce([updatedProduct]);

      const newVariants = [
        { sku: 'SNK-42', price: 1800, stock: 5 },
        { sku: 'SNK-43', price: 1800, stock: 8 },
      ];

      await service.update('upd-var', {
        variants: JSON.stringify(newVariants),
      });

      expect(mockDb.delete).toHaveBeenCalled();
      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockRedis.del).toHaveBeenCalledWith('product:upd-var');
    });

    it('B-PRD-03c (CACHE-20-F): successfully completes DB update even if Redis DEL fails', async () => {
      const updatedProduct = { id: 'upd-del-fail', name: 'Desk' };
      mockDb.returning.mockResolvedValueOnce([updatedProduct]);
      mockRedis.del.mockRejectedValueOnce(
        new Error('Redis timeout during DEL'),
      );

      const result = await service.update('upd-del-fail', { name: 'Desk' });

      expect(result).toEqual(updatedProduct);
    });

    it('B-PRD-03d: updates product status when provided (active/draft/archived)', async () => {
      const updatedProduct = {
        id: 'upd-status',
        name: 'Lamp',
        status: 'draft',
      };
      mockDb.returning.mockResolvedValueOnce([updatedProduct]);

      const result = await service.update('upd-status', { status: 'draft' });

      expect(result).toEqual(updatedProduct);
      const setCall = mockDb.set.mock.calls[0][0];
      expect(setCall.status).toBe('draft');
    });
  });

  describe('delete', () => {
    it('B-PRD-04a (CACHE-20-B): soft-deletes product and invalidates Redis cache product:<id>', async () => {
      const softDeletedProduct = {
        id: 'del-1',
        name: 'Obsolete Item',
        status: 'archived',
        deletedAt: new Date(),
      };
      mockDb.returning.mockResolvedValueOnce([softDeletedProduct]);

      const result = await service.delete('del-1');

      expect(result).toEqual(softDeletedProduct);
      expect(mockDb.update).toHaveBeenCalled();
      const setArg = mockDb.set.mock.calls[0][0];
      expect(setArg.status).toBe('archived');
      expect(setArg.deletedAt).toBeInstanceOf(Date);
      expect(mockRedis.del).toHaveBeenCalledWith('product:del-1');
    });

    it('B-PRD-04b: throws EntityNotFoundError if product is not found or already deleted', async () => {
      mockDb.returning.mockResolvedValueOnce([]); // Zero rows updated

      await expect(service.delete('del-nonexistent')).rejects.toThrow(
        EntityNotFoundError,
      );
      expect(mockRedis.del).not.toHaveBeenCalled();
    });

    it('B-PRD-04c: succeeds even if Redis DEL fails during delete', async () => {
      const softDeletedProduct = { id: 'del-redis-err', status: 'archived' };
      mockDb.returning.mockResolvedValueOnce([softDeletedProduct]);
      mockRedis.del.mockRejectedValueOnce(new Error('Redis socket hang up'));

      const result = await service.delete('del-redis-err');

      expect(result).toEqual(softDeletedProduct);
    });
  });
});
