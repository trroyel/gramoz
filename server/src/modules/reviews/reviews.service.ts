import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ReviewsStore } from './reviews.store';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { SettingsService } from '../settings/settings.service';
import { OrdersStore } from '../orders/orders.store';
import { RedisService } from '@cache/redis.service';
import * as schema from '@database/schema';

@Injectable()
export class ReviewsService {
  constructor(
    private readonly reviewsStore: ReviewsStore,
    private readonly loyaltyService: LoyaltyService,
    private readonly settingsService: SettingsService,
    private readonly ordersStore: OrdersStore,
    private readonly redisService: RedisService,
  ) {}

  async submitReview(
    userId: string,
    orderId: string,
    productId: string,
    rating: number,
    comment?: string,
    images?: string[],
  ) {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new BadRequestException(
        'Rating must be an integer between 1 and 5',
      );
    }
    if (comment && comment.length > 5000) {
      throw new BadRequestException('Comment cannot exceed 5000 characters');
    }
    if (images && images.length > 5) {
      throw new BadRequestException('Maximum of 5 images allowed');
    }

    // 0. Verify the product is active if found (not soft-deleted or archived)
    if (this.reviewsStore.getProductById) {
      const product = await this.reviewsStore.getProductById(productId);
      if (product && (product.deletedAt || product.status === 'archived')) {
        throw new NotFoundException('Product not found or unavailable');
      }
    }

    // 1. Verify the order belongs to the user and is delivered
    const order = await this.ordersStore.getOrderDetailsWithPayments(
      userId,
      orderId,
    );
    if (!order) {
      throw new NotFoundException('Order not found for this user');
    }
    if (order.status !== 'delivered') {
      throw new BadRequestException(
        'You can only review products from delivered orders',
      );
    }

    // 2. Verify the product was actually in this order
    const orderItems =
      await this.ordersStore.getOrderItemsWithProducts(orderId);
    // Canonical purchase identity (TASK-26): the LOWEST order_items.id for this (order, product).
    // The query is unordered, so `find()` alone could return different rows across calls when an
    // order holds several rows of the same product (e.g. variants) — letting a deleted/recreated
    // review be rewarded again. Migration 0029 maps legacy rewards to the same canonical item.
    const orderItem = orderItems
      .filter((item) => item.productId === productId)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
    if (!orderItem) {
      throw new BadRequestException(
        'This product is not part of the specified order',
      );
    }

    // 3. Prevent duplicate active reviews
    const existing = await this.reviewsStore.getReviewByUserAndProductAndOrder(
      userId,
      productId,
      orderId,
    );
    if (existing) {
      throw new BadRequestException(
        'You have already reviewed this product for this order',
      );
    }

    // 4. Run Transaction: Create Review + Award Points
    const review = await this.reviewsStore.runTransaction(async (tx) => {
      let createdReview: schema.Review;
      try {
        createdReview = await this.reviewsStore.createReview(
          {
            userId,
            productId,
            orderId,
            rating,
            comment,
            images: images || [],
            status: 'pending', // Requires admin approval
          },
          tx,
        );
      } catch (err: unknown) {
        const error = err as { code?: string; message?: string };
        if (
          error?.code === '23505' ||
          error?.message?.includes('idx_unique_review_per_purchase')
        ) {
          throw new BadRequestException(
            'You have already reviewed this product for this order',
          );
        }
        throw err;
      }

      // Award points using stable purchase identity (orderItem.id) to prevent duplicate rewards on review deletion/recreation
      let pointsToAward = 0;
      let transactionType: 'earned_review_text' | 'earned_review_media' =
        'earned_review_text';

      if (images && images.length > 0) {
        pointsToAward = await this.settingsService.getMediaReviewPoints();
        transactionType = 'earned_review_media';
      } else if (comment && comment.length > 10) {
        pointsToAward = await this.settingsService.getTextReviewPoints();
        transactionType = 'earned_review_text';
      }

      const purchaseReferenceId = orderItem?.id || createdReview.id;
      if (pointsToAward > 0) {
        await this.loyaltyService.awardPoints(
          userId,
          pointsToAward,
          transactionType,
          purchaseReferenceId,
          tx,
        );
      }

      return createdReview;
    });

    return review;
  }

  async getMyReviews(userId: string, page = 1, limit = 10) {
    const offset = (Math.max(1, page) - 1) * limit;
    return this.reviewsStore.getReviewsByUser(userId, limit, offset);
  }

  async updateCustomerReview(
    userId: string,
    id: string,
    data: { rating?: number; comment?: string; images?: string[] },
  ) {
    if (data.rating !== undefined) {
      if (
        !Number.isInteger(data.rating) ||
        data.rating < 1 ||
        data.rating > 5
      ) {
        throw new BadRequestException(
          'Rating must be an integer between 1 and 5',
        );
      }
    }
    if (data.comment && data.comment.length > 5000) {
      throw new BadRequestException('Comment cannot exceed 5000 characters');
    }
    if (data.images && data.images.length > 5) {
      throw new BadRequestException('Maximum of 5 images allowed');
    }

    const existing = await this.reviewsStore.getReviewById(id);
    if (!existing || existing.userId !== userId) {
      throw new NotFoundException('Review not found or unauthorized');
    }

    const review = await this.reviewsStore.updateUserReview(id, userId, data);
    if (!review) throw new NotFoundException('Review not found');

    if (review.productId) {
      await this.redisService
        .del(`product:${review.productId}`)
        .catch(() => {});
    }

    return review;
  }

  async deleteCustomerReview(userId: string, id: string) {
    const existing = await this.reviewsStore.getReviewById(id);
    if (!existing || existing.userId !== userId) {
      throw new NotFoundException('Review not found or unauthorized');
    }

    const review = await this.reviewsStore.deleteUserReview(id, userId);
    if (!review) throw new NotFoundException('Review not found');

    if (review.productId) {
      await this.redisService
        .del(`product:${review.productId}`)
        .catch(() => {});
    }

    return review;
  }

  async getProductReviews(productId: string, page = 1, limit = 10) {
    const offset = (Math.max(1, page) - 1) * limit;
    return this.reviewsStore.getProductReviews(productId, limit, offset);
  }

  async getProductReviewStats(productId: string) {
    return this.reviewsStore.getProductReviewStats(productId);
  }

  async getAllForAdmin(page = 1, limit = 20) {
    const offset = (Math.max(1, page) - 1) * limit;
    return this.reviewsStore.findAllForAdmin(limit, offset);
  }

  async updateReviewStatus(
    id: string,
    status: 'pending' | 'approved' | 'rejected',
  ) {
    const review = await this.reviewsStore.updateStatus(id, status);
    if (!review) throw new NotFoundException('Review not found');

    // Invalidate product cache in Redis so product detail immediately reflects updated rating
    if (review.productId) {
      await this.redisService
        .del(`product:${review.productId}`)
        .catch(() => {});
    }

    return review;
  }

  async deleteReview(id: string) {
    const review = await this.reviewsStore.deleteReview(id);
    if (!review) throw new NotFoundException('Review not found');

    // Invalidate product cache in Redis so product detail immediately reflects updated rating
    if (review.productId) {
      await this.redisService
        .del(`product:${review.productId}`)
        .catch(() => {});
    }

    return review;
  }
}
