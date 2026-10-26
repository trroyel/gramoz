import { Reflector } from '@nestjs/core';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { StorageService } from '../storage/storage.service';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@modules/auth/guards/roles.guard';
import { Role } from '@database/schema';
import { ROLES_KEY } from '@modules/auth/decorators/roles.decorator';

describe('ProductsController (Unit Tests — TASK-20)', () => {
  let controller: ProductsController;
  let mockProductsService: jest.Mocked<Partial<ProductsService>>;
  let mockStorageService: jest.Mocked<Partial<StorageService>>;

  const createMockRes = () => {
    const res: any = {};
    res.status = jest.fn().mockReturnValue(res);
    res.send = jest.fn().mockReturnValue(res);
    return res;
  };

  beforeEach(() => {
    mockProductsService = {
      create: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    mockStorageService = {
      upload: jest.fn(),
    };

    controller = new ProductsController(
      mockProductsService as unknown as ProductsService,
      mockStorageService as unknown as StorageService,
    );
  });

  describe('Security & Guard Metadata', () => {
    const reflector = new Reflector();

    it('B-PRD-SEC-01: create requires JwtAuthGuard, RolesGuard with SUPER_ADMIN, ADMIN, MANAGER', () => {
      const guards = reflector.get('__guards__', controller.create);
      expect(guards).toContain(JwtAuthGuard);
      expect(guards).toContain(RolesGuard);

      const roles = reflector.get(ROLES_KEY, controller.create);
      expect(roles).toEqual([Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER]);
    });

    it('B-PRD-SEC-02: update requires JwtAuthGuard, RolesGuard with SUPER_ADMIN, ADMIN, MANAGER', () => {
      const guards = reflector.get('__guards__', controller.update);
      expect(guards).toContain(JwtAuthGuard);
      expect(guards).toContain(RolesGuard);

      const roles = reflector.get(ROLES_KEY, controller.update);
      expect(roles).toEqual([Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER]);
    });

    it('B-PRD-SEC-03: remove requires JwtAuthGuard, RolesGuard with SUPER_ADMIN, ADMIN only (MANAGER forbidden)', () => {
      const guards = reflector.get('__guards__', controller.remove);
      expect(guards).toContain(JwtAuthGuard);
      expect(guards).toContain(RolesGuard);

      const roles = reflector.get(ROLES_KEY, controller.remove);
      expect(roles).toEqual([Role.SUPER_ADMIN, Role.ADMIN]);
      expect(roles).not.toContain(Role.MANAGER);
    });

    it('B-PRD-SEC-04: findAll and findOne are public endpoints without auth guards', () => {
      const findAllGuards = reflector.get('__guards__', controller.findAll);
      const findOneGuards = reflector.get('__guards__', controller.findOne);
      expect(findAllGuards).toBeUndefined();
      expect(findOneGuards).toBeUndefined();
    });
  });

  describe('create', () => {
    it('B-PRD-VAL-01: rejects empty product name with HTTP 400', async () => {
      const req: any = { parsedBody: { name: '   ', price: 100, stock: 10 } };
      const res = createMockRes();

      await controller.create(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.send).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: 'Product name is required',
        }),
      );
    });

    it('B-PRD-VAL-02: rejects invalid or negative price with HTTP 400', async () => {
      const req: any = { parsedBody: { name: 'Polo', price: -50, stock: 10 } };
      const res = createMockRes();

      await controller.create(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.send).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: 'Valid price is required',
        }),
      );
    });

    it('B-PRD-VAL-03: rejects invalid or negative stock with HTTP 400', async () => {
      const req: any = { parsedBody: { name: 'Polo', price: 500, stock: -1 } };
      const res = createMockRes();

      await controller.create(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.send).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: 'Valid stock quantity is required',
        }),
      );
    });

    it('B-PRD-VAL-04: successfully creates product and returns HTTP 201', async () => {
      const created = {
        id: 'p-1',
        name: 'Premium Tee',
        price: '450.00',
        stock: 25,
      };
      mockProductsService.create.mockResolvedValueOnce(created as any);

      const req: any = {
        parsedBody: {
          name: 'Premium Tee',
          price: '450',
          stock: '25',
          description: '100% cotton',
        },
      };
      const res = createMockRes();

      await controller.create(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.send).toHaveBeenCalledWith({
        success: true,
        message: 'Product created successfully',
        data: created,
      });
    });

    it('B-PRD-VAL-05: uploads image via storageService when uploadedFile is present', async () => {
      mockStorageService.upload.mockResolvedValueOnce(
        'https://r2.gramoz.com/tee.jpg',
      );
      mockProductsService.create.mockResolvedValueOnce({ id: 'p-img' } as any);

      const req: any = {
        parsedBody: { name: 'Jacket', price: 1500, stock: 5 },
        uploadedFile: {
          file: Buffer.from('data'),
          filename: 'tee.jpg',
          mimetype: 'image/jpeg',
        },
      };
      const res = createMockRes();

      await controller.create(req, res);

      expect(mockStorageService.upload).toHaveBeenCalledWith(
        req.uploadedFile.file,
        req.uploadedFile.filename,
        req.uploadedFile.mimetype,
      );
      expect(mockProductsService.create).toHaveBeenCalledWith(
        expect.any(Object),
        'https://r2.gramoz.com/tee.jpg',
      );
    });
  });

  describe('update', () => {
    it('B-PRD-VAL-06: returns HTTP 404 if product to update does not exist', async () => {
      mockProductsService.findOne.mockResolvedValueOnce(undefined);
      const req: any = { parsedBody: { name: 'New Name' } };
      const res = createMockRes();

      await controller.update('non-existent', req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.send).toHaveBeenCalledWith({
        success: false,
        message: 'Product not found',
      });
    });

    it('B-PRD-VAL-07: rejects empty name update with HTTP 400', async () => {
      mockProductsService.findOne.mockResolvedValueOnce({
        id: 'p-upd',
      } as any);
      const req: any = { parsedBody: { name: '   ' } };
      const res = createMockRes();

      await controller.update('p-upd', req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.send).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: 'Product name cannot be empty',
        }),
      );
    });

    it('B-PRD-VAL-08: rejects negative price update with HTTP 400', async () => {
      mockProductsService.findOne.mockResolvedValueOnce({
        id: 'p-upd',
      } as any);
      const req: any = { parsedBody: { price: -99 } };
      const res = createMockRes();

      await controller.update('p-upd', req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.send).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: 'Valid price is required',
        }),
      );
    });

    it('B-PRD-VAL-09: rejects negative stock update with HTTP 400', async () => {
      mockProductsService.findOne.mockResolvedValueOnce({
        id: 'p-upd',
      } as any);
      const req: any = { parsedBody: { stock: -10 } };
      const res = createMockRes();

      await controller.update('p-upd', req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.send).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: 'Valid stock quantity is required',
        }),
      );
    });

    it('B-PRD-VAL-10: rejects invalid product status update with HTTP 400', async () => {
      mockProductsService.findOne.mockResolvedValueOnce({
        id: 'p-upd',
      } as any);
      const req: any = { parsedBody: { status: 'destroyed' } };
      const res = createMockRes();

      await controller.update('p-upd', req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.send).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: 'Invalid product status',
        }),
      );
    });

    it('B-PRD-VAL-11: passes variants and status to productsService.update', async () => {
      mockProductsService.findOne.mockResolvedValueOnce({
        id: 'p-upd',
      } as any);
      const updated = { id: 'p-upd', name: 'Updated', status: 'draft' };
      mockProductsService.update.mockResolvedValueOnce(updated as any);

      const req: any = {
        parsedBody: {
          name: 'Updated',
          status: 'draft',
          variants: [{ sku: 'VAR-1', price: 100 }],
        },
      };
      const res = createMockRes();

      await controller.update('p-upd', req, res);

      expect(mockProductsService.update).toHaveBeenCalledWith(
        'p-upd',
        expect.objectContaining({
          name: 'Updated',
          status: 'draft',
          variants: JSON.stringify([{ sku: 'VAR-1', price: 100 }]),
        }),
        undefined,
      );
      expect(res.send).toHaveBeenCalledWith({
        success: true,
        message: 'Product updated successfully',
        data: updated,
      });
    });
  });

  describe('remove', () => {
    it('B-PRD-VAL-12: returns HTTP 404 if product to delete does not exist', async () => {
      mockProductsService.findOne.mockResolvedValueOnce(undefined);
      const res = createMockRes();

      await controller.remove('p-missing', res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.send).toHaveBeenCalledWith({
        success: false,
        message: 'Product not found',
      });
    });

    it('B-PRD-VAL-13: successfully deletes product and returns HTTP 200', async () => {
      mockProductsService.findOne.mockResolvedValueOnce({
        id: 'p-del',
      } as any);
      mockProductsService.delete.mockResolvedValueOnce({ id: 'p-del' } as any);
      const res = createMockRes();

      await controller.remove('p-del', res);

      expect(mockProductsService.delete).toHaveBeenCalledWith('p-del');
      expect(res.send).toHaveBeenCalledWith({
        success: true,
        message: 'Product deleted successfully',
      });
    });
  });

  describe('findOne', () => {
    it('B-PRD-VAL-14: returns HTTP 404 when product is not found', async () => {
      mockProductsService.findOne.mockResolvedValueOnce(undefined);
      const res = createMockRes();

      await controller.findOne('p-not-found', res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.send).toHaveBeenCalledWith({
        success: false,
        message: 'Product not found',
      });
    });

    it('B-PRD-VAL-15: returns HTTP 200 with product details when found', async () => {
      const prod = { id: 'p-ok', name: 'Hoodie', price: '1200.00' };
      mockProductsService.findOne.mockResolvedValueOnce(prod as any);
      const res = createMockRes();

      await controller.findOne('p-ok', res);

      expect(res.send).toHaveBeenCalledWith({
        success: true,
        message: 'Product retrieved successfully',
        data: prod,
      });
    });
  });

  describe('findAll', () => {
    it('B-PRD-VAL-16: delegates query parameters and returns 200 with data and meta', async () => {
      const query = { page: '1', limit: '20', q: 'hoodie' };
      const response = {
        data: [{ id: 'p1', name: 'Hoodie' } as any],
        meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
      };
      mockProductsService.findAll.mockResolvedValueOnce(response);
      const res = createMockRes();

      await controller.findAll(query, res);

      expect(mockProductsService.findAll).toHaveBeenCalledWith(query);
      expect(res.send).toHaveBeenCalledWith({
        success: true,
        message: 'Products retrieved successfully',
        data: response.data,
        meta: response.meta,
      });
    });
  });
});
