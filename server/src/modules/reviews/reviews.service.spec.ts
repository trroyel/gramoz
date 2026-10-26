import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import { ReviewsStore } from './reviews.store';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { SettingsService } from '../settings/settings.service';
import { OrdersStore } from '../orders/orders.store';
import { RedisService } from '@cache/redis.service';

describe('ReviewsService (Unit Tests — TASK-11b)', () => {
  let service: ReviewsService;
  let reviewsStore: jest.Mocked<ReviewsStore>;
  let loyaltyService: jest.Mocked<LoyaltyService>;
  let settingsService: jest.Mocked<SettingsService>;
  let ordersStore: jest.Mocked<OrdersStore>;
  let redisService: jest.Mocked<RedisService>;

  beforeEach(async () => {
    const mockReviewsStore = {
      runTransaction: jest.fn((cb) => cb({})),
      createReview: jest.fn(),
      getReviewByUserAndProductAndOrder: jest.fn(),
      getProductReviews: jest.fn(),
      getProductReviewStats: jest.fn(),
      getReviewById: jest.fn(),
      findAllForAdmin: jest.fn(),
      updateStatus: jest.fn(),
      deleteReview: jest.fn(),
    };

    const mockLoyaltyService = {
      awardPoints: jest.fn(),
    };

    const mockSettingsService = {
      getTextReviewPoints: jest.fn().mockResolvedValue(10),
      getMediaReviewPoints: jest.fn().mockResolvedValue(25),
    };

    const mockOrdersStore = {
      getOrderDetailsWithPayments: jest.fn(),
      getOrderItemsWithProducts: jest.fn(),
    };

    const mockRedisService = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn().mockResolvedValue(1),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReviewsService,
        { provide: ReviewsStore, useValue: mockReviewsStore },
        { provide: LoyaltyService, useValue: mockLoyaltyService },
        { provide: SettingsService, useValue: mockSettingsService },
        { provide: OrdersStore, useValue: mockOrdersStore },
        { provide: RedisService, useValue: mockRedisService },
      ],
    }).compile();

    service = module.get<ReviewsService>(ReviewsService);
    reviewsStore = module.get(ReviewsStore);
    loyaltyService = module.get(LoyaltyService);
    settingsService = module.get(SettingsService);
    ordersStore = module.get(OrdersStore);
    redisService = module.get(RedisService);
  });

  describe('submitReview Validation & Business Invariants', () => {
    const userId = 'user-123';
    const orderId = 'order-456';
    const productId = 'prod-789';

    it('rejects invalid rating values (non-integers, < 1, > 5)', async () => {
      await expect(
        service.submitReview(userId, orderId, productId, 0),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.submitReview(userId, orderId, productId, 6),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.submitReview(userId, orderId, productId, 4.5),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.submitReview(userId, orderId, productId, NaN),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects submission if order does not exist for the user', async () => {
      ordersStore.getOrderDetailsWithPayments.mockResolvedValue(null as any);

      await expect(
        service.submitReview(userId, orderId, productId, 5),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects submission if order is not delivered', async () => {
      ordersStore.getOrderDetailsWithPayments.mockResolvedValue({
        id: orderId,
        userId,
        status: 'shipped',
      } as any);

      await expect(
        service.submitReview(userId, orderId, productId, 5),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects submission if product was not purchased in this order', async () => {
      ordersStore.getOrderDetailsWithPayments.mockResolvedValue({
        id: orderId,
        userId,
        status: 'delivered',
      } as any);
      ordersStore.getOrderItemsWithProducts.mockResolvedValue([
        { productId: 'other-product' },
      ] as any);

      await expect(
        service.submitReview(userId, orderId, productId, 5),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects duplicate review before insertion if existing review is found', async () => {
      ordersStore.getOrderDetailsWithPayments.mockResolvedValue({
        id: orderId,
        userId,
        status: 'delivered',
      } as any);
      ordersStore.getOrderItemsWithProducts.mockResolvedValue([
        { productId },
      ] as any);
      reviewsStore.getReviewByUserAndProductAndOrder.mockResolvedValue({
        id: 'rev-existing',
      } as any);

      await expect(
        service.submitReview(userId, orderId, productId, 5),
      ).rejects.toThrow(BadRequestException);
    });

    it('catches PostgreSQL unique constraint violation (23505) and returns clean BadRequestException', async () => {
      ordersStore.getOrderDetailsWithPayments.mockResolvedValue({
        id: orderId,
        userId,
        status: 'delivered',
      } as any);
      ordersStore.getOrderItemsWithProducts.mockResolvedValue([
        { productId },
      ] as any);
      reviewsStore.getReviewByUserAndProductAndOrder.mockResolvedValue(null);

      const dbErr: any = new Error(
        'duplicate key value violates unique constraint',
      );
      dbErr.code = '23505';
      reviewsStore.createReview.mockRejectedValue(dbErr);

      await expect(
        service.submitReview(userId, orderId, productId, 5),
      ).rejects.toThrow(BadRequestException);
    });

    it('propagates unexpected database errors', async () => {
      ordersStore.getOrderDetailsWithPayments.mockResolvedValue({
        id: orderId,
        userId,
        status: 'delivered',
      } as any);
      ordersStore.getOrderItemsWithProducts.mockResolvedValue([
        { productId },
      ] as any);
      reviewsStore.getReviewByUserAndProductAndOrder.mockResolvedValue(null);

      const dbErr = new Error('connection lost');
      reviewsStore.createReview.mockRejectedValue(dbErr);

      await expect(
        service.submitReview(userId, orderId, productId, 5),
      ).rejects.toThrow('connection lost');
    });

    it('creates review with pending status and awards text loyalty points when comment > 10 chars', async () => {
      ordersStore.getOrderDetailsWithPayments.mockResolvedValue({
        id: orderId,
        userId,
        status: 'delivered',
      } as any);
      ordersStore.getOrderItemsWithProducts.mockResolvedValue([
        { productId },
      ] as any);
      reviewsStore.getReviewByUserAndProductAndOrder.mockResolvedValue(null);

      const createdReview = {
        id: 'rev-1',
        userId,
        orderId,
        productId,
        rating: 5,
        comment: 'Great quality rural product!',
        status: 'pending',
      };
      reviewsStore.createReview.mockResolvedValue(createdReview as any);

      const result = await service.submitReview(
        userId,
        orderId,
        productId,
        5,
        'Great quality rural product!',
      );

      expect(result).toEqual(createdReview);
      expect(reviewsStore.createReview).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          orderId,
          productId,
          rating: 5,
          status: 'pending',
        }),
        expect.anything(),
      );
      expect(loyaltyService.awardPoints).toHaveBeenCalledWith(
        userId,
        10,
        'earned_review_text',
        'rev-1',
        expect.anything(),
      );
    });

    it('awards media loyalty points when images are uploaded with review', async () => {
      ordersStore.getOrderDetailsWithPayments.mockResolvedValue({
        id: orderId,
        userId,
        status: 'delivered',
      } as any);
      ordersStore.getOrderItemsWithProducts.mockResolvedValue([
        { productId },
      ] as any);
      reviewsStore.getReviewByUserAndProductAndOrder.mockResolvedValue(null);

      const createdReview = {
        id: 'rev-2',
        userId,
        orderId,
        productId,
        rating: 5,
        images: ['https://cdn.gramoz.com/img1.jpg'],
        status: 'pending',
      };
      reviewsStore.createReview.mockResolvedValue(createdReview as any);

      const result = await service.submitReview(
        userId,
        orderId,
        productId,
        5,
        'Nice',
        ['https://cdn.gramoz.com/img1.jpg'],
      );

      expect(result).toEqual(createdReview);
      expect(loyaltyService.awardPoints).toHaveBeenCalledWith(
        userId,
        25,
        'earned_review_media',
        'rev-2',
        expect.anything(),
      );
    });

    it('TASK-26: deterministically picks the canonical (lowest id) order item when an order has multiple items of the same product', async () => {
      ordersStore.getOrderDetailsWithPayments.mockResolvedValue({
        id: orderId,
        userId,
        status: 'delivered',
      } as any);
      // Unordered list of multiple items of the same product
      ordersStore.getOrderItemsWithProducts.mockResolvedValue([
        { id: 'item-zzz', productId },
        { id: 'item-aaa', productId },
        { id: 'item-mmm', productId },
      ] as any);
      reviewsStore.getReviewByUserAndProductAndOrder.mockResolvedValue(null);

      const createdReview = {
        id: 'rev-canonical-1',
        userId,
        orderId,
        productId,
        rating: 5,
        comment: 'Detailed review for item',
        status: 'pending',
      };
      reviewsStore.createReview.mockResolvedValue(createdReview as any);

      await service.submitReview(
        userId,
        orderId,
        productId,
        5,
        'Detailed review for item',
      );

      // Verify that loyalty points reference the lowest ID ('item-aaa')
      expect(loyaltyService.awardPoints).toHaveBeenCalledWith(
        userId,
        10,
        'earned_review_text',
        'item-aaa',
        expect.anything(),
      );
    });
  });

  describe('Moderation State Transitions & Redis Cache Invalidation', () => {
    it('updates review status and busts the product detail Redis cache', async () => {
      const existingReview = {
        id: 'rev-1',
        productId: 'prod-123',
        status: 'approved',
      };
      reviewsStore.updateStatus.mockResolvedValue(existingReview as any);

      const result = await service.updateReviewStatus('rev-1', 'approved');

      expect(result).toEqual(existingReview);
      expect(reviewsStore.updateStatus).toHaveBeenCalledWith(
        'rev-1',
        'approved',
      );
      expect(redisService.del).toHaveBeenCalledWith('product:prod-123');
    });

    it('throws NotFoundException if updating non-existent review', async () => {
      reviewsStore.updateStatus.mockResolvedValue(null as any);

      await expect(
        service.updateReviewStatus('rev-nonexistent', 'approved'),
      ).rejects.toThrow(NotFoundException);
      expect(redisService.del).not.toHaveBeenCalled();
    });

    it('deletes review and busts product detail Redis cache', async () => {
      const deletedReview = {
        id: 'rev-1',
        productId: 'prod-123',
      };
      reviewsStore.deleteReview.mockResolvedValue(deletedReview as any);

      const result = await service.deleteReview('rev-1');

      expect(result).toEqual(deletedReview);
      expect(reviewsStore.deleteReview).toHaveBeenCalledWith('rev-1');
      expect(redisService.del).toHaveBeenCalledWith('product:prod-123');
    });

    it('throws NotFoundException if deleting non-existent review', async () => {
      reviewsStore.deleteReview.mockResolvedValue(null as any);

      await expect(service.deleteReview('rev-nonexistent')).rejects.toThrow(
        NotFoundException,
      );
      expect(redisService.del).not.toHaveBeenCalled();
    });
  });

  describe('Review Aggregation & Stats Retrieval', () => {
    it('returns 0 averageRating and 0 reviewCount for zero-review product', async () => {
      reviewsStore.getProductReviewStats.mockResolvedValue({
        averageRating: 0,
        reviewCount: 0,
      });

      const stats = await service.getProductReviewStats('prod-no-reviews');
      expect(stats).toEqual({ averageRating: 0, reviewCount: 0 });
    });

    it('returns exact rating for single review', async () => {
      reviewsStore.getProductReviewStats.mockResolvedValue({
        averageRating: 5.0,
        reviewCount: 1,
      });

      const stats = await service.getProductReviewStats('prod-single');
      expect(stats).toEqual({ averageRating: 5.0, reviewCount: 1 });
    });

    it('returns rounded rating for multiple reviews (e.g. 4.33 for 13/3)', async () => {
      reviewsStore.getProductReviewStats.mockResolvedValue({
        averageRating: 4.33,
        reviewCount: 3,
      });

      const stats = await service.getProductReviewStats('prod-multi');
      expect(stats.averageRating).toBe(4.33);
      expect(stats.reviewCount).toBe(3);
    });

    it('paginates product reviews with default limit and offset', async () => {
      reviewsStore.getProductReviews.mockResolvedValue([]);

      await service.getProductReviews('prod-123', 2, 10);
      expect(reviewsStore.getProductReviews).toHaveBeenCalledWith(
        'prod-123',
        10,
        10,
      );
    });
  });
});
