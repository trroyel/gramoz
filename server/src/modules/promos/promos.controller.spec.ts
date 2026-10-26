import { Test, TestingModule } from '@nestjs/testing';
import { PromosController } from './controllers/promos/promos.controller';
import { PromosAdminController } from './controllers/promos-admin/promos-admin.controller';
import { PromosService } from './promos.service';
import { Role } from '@database/schema';

describe('Promos Controllers', () => {
  let promosController: PromosController;
  let promosAdminController: PromosAdminController;
  let mockPromosService: any;

  beforeEach(async () => {
    mockPromosService = {
      findPublicActive: jest.fn(),
      validate: jest.fn(),
      create: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
      toggleActive: jest.fn(),
      delete: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PromosController, PromosAdminController],
      providers: [
        {
          provide: PromosService,
          useValue: mockPromosService,
        },
      ],
    }).compile();

    promosController = module.get<PromosController>(PromosController);
    promosAdminController = module.get<PromosAdminController>(
      PromosAdminController,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('PromosController (Public / Customer)', () => {
    it('getActivePromos returns public active promos', async () => {
      const publicPromos = [
        {
          id: 'p1',
          code: 'PROMO1',
          discountType: 'fixed',
          discountValue: '50.00',
        },
      ];
      mockPromosService.findPublicActive.mockResolvedValue(publicPromos);

      const response = await promosController.getActivePromos();
      expect(response).toEqual({ success: true, data: publicPromos });
      expect(mockPromosService.findPublicActive).toHaveBeenCalledTimes(1);
    });

    it('validatePromo validates coupon against subtotal and returns result', async () => {
      const validationResult = {
        promoId: 'p1',
        code: 'SAVE10',
        discountType: 'percentage',
        discountValue: 10,
        discountAmount: 25,
      };
      mockPromosService.validate.mockResolvedValue(validationResult);

      const response = await promosController.validatePromo({
        code: 'SAVE10',
        subtotal: 250,
      });

      expect(response).toEqual({ success: true, data: validationResult });
      expect(mockPromosService.validate).toHaveBeenCalledWith({
        code: 'SAVE10',
        subtotal: 250,
      });
    });
  });

  describe('PromosAdminController (Admin CRUD)', () => {
    it('create invokes service.create with valid dto', async () => {
      const createdPromo = {
        id: 'new-p',
        code: 'ADMIN20',
        discountType: 'percentage',
        discountValue: '20.00',
        isActive: true,
      };
      mockPromosService.create.mockResolvedValue(createdPromo);

      const dto = {
        code: 'ADMIN20',
        discountType: 'percentage' as const,
        discountValue: 20,
      };
      const response = await promosAdminController.create(dto);

      expect(response).toEqual({ success: true, data: createdPromo });
      expect(mockPromosService.create).toHaveBeenCalledWith(dto);
    });

    it('findAll returns all promos in the system', async () => {
      const allPromos = [
        { id: 'p1', code: 'PROMO1' },
        { id: 'p2', code: 'PROMO2' },
      ];
      mockPromosService.findAll.mockResolvedValue(allPromos);

      const response = await promosAdminController.findAll();
      expect(response).toEqual({ success: true, data: allPromos });
      expect(mockPromosService.findAll).toHaveBeenCalledTimes(1);
    });

    it('findOne returns single promo by ID', async () => {
      const promo = { id: 'p1', code: 'PROMO1' };
      mockPromosService.findOne.mockResolvedValue(promo);

      const response = await promosAdminController.findOne('p1');
      expect(response).toEqual({ success: true, data: promo });
      expect(mockPromosService.findOne).toHaveBeenCalledWith('p1');
    });

    it('toggleActive toggles active status', async () => {
      const toggled = { id: 'p1', isActive: false };
      mockPromosService.toggleActive.mockResolvedValue(toggled);

      const response = await promosAdminController.toggleActive('p1');
      expect(response).toEqual({ success: true, data: toggled });
      expect(mockPromosService.toggleActive).toHaveBeenCalledWith('p1');
    });

    it('remove deletes promo by ID', async () => {
      mockPromosService.delete.mockResolvedValue({ id: 'p1' });

      const response = await promosAdminController.remove('p1');
      expect(response).toEqual({ success: true });
      expect(mockPromosService.delete).toHaveBeenCalledWith('p1');
    });

    it('enforces ADMIN and SUPER_ADMIN roles on controller metadata', () => {
      const roles = Reflect.getMetadata('roles', PromosAdminController);
      expect(roles).toEqual([Role.SUPER_ADMIN, Role.ADMIN]);
    });
  });
});
