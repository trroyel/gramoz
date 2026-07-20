import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { ReviewsStore } from './reviews.store';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { SettingsService } from '../settings/settings.service';
import { OrdersStore } from '../orders/orders.store';
import * as schema from '@database/schema';

@Injectable()
export class ReviewsService {
  constructor(
    private readonly reviewsStore: ReviewsStore,
    private readonly loyaltyService: LoyaltyService,
    private readonly settingsService: SettingsService,
    private readonly ordersStore: OrdersStore,
  ) {}

  async submitReview(
    userId: string,
    orderId: string,
    productId: string,
    rating: number,
    comment?: string,
    images?: string[],
  ) {
    if (rating < 1 || rating > 5) {
      throw new BadRequestException('Rating must be between 1 and 5');
    }

    // 1. Verify the order belongs to the user and is delivered
    const order = await this.ordersStore.getOrderDetailsWithPayments(userId, orderId);
    if (!order) {
      throw new NotFoundException('Order not found for this user');
    }
    if (order.status !== 'delivered') {
      throw new BadRequestException('You can only review products from delivered orders');
    }

    // 2. Verify the product was actually in this order
    const orderItems = await this.ordersStore.getOrderItemsWithProducts(orderId);
    const hasProduct = orderItems.some(item => item.productId === productId);
    if (!hasProduct) {
      throw new BadRequestException('This product is not part of the specified order');
    }

    // 3. Prevent duplicate reviews
    const existing = await this.reviewsStore.getReviewByUserAndProductAndOrder(userId, productId, orderId);
    if (existing) {
      throw new BadRequestException('You have already reviewed this product for this order');
    }

    // 4. Run Transaction: Create Review + Award Points
    const review = await this.reviewsStore.runTransaction(async (tx) => {
      const createdReview = await this.reviewsStore.createReview(
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

      // Award points
      let pointsToAward = 0;
      let transactionType: 'earned_review_text' | 'earned_review_media' = 'earned_review_text';

      if (images && images.length > 0) {
        pointsToAward = await this.settingsService.getMediaReviewPoints();
        transactionType = 'earned_review_media';
      } else if (comment && comment.length > 10) {
        pointsToAward = await this.settingsService.getTextReviewPoints();
        transactionType = 'earned_review_text';
      }

      if (pointsToAward > 0) {
        await this.loyaltyService.awardPoints(
          userId,
          pointsToAward,
          transactionType,
          createdReview.id,
          tx,
        );
      }

      return createdReview;
    });

    return review;
  }

  async getProductReviews(productId: string, page = 1, limit = 10) {
    const offset = (Math.max(1, page) - 1) * limit;
    return this.reviewsStore.getProductReviews(productId, limit, offset);
  }

  async getAllForAdmin(page = 1, limit = 20) {
    const offset = (Math.max(1, page) - 1) * limit;
    return this.reviewsStore.findAllForAdmin(limit, offset);
  }

  async updateReviewStatus(id: string, status: 'pending' | 'approved' | 'rejected') {
    const review = await this.reviewsStore.updateStatus(id, status);
    if (!review) throw new NotFoundException('Review not found');
    return review;
  }

  async deleteReview(id: string) {
    const review = await this.reviewsStore.deleteReview(id);
    if (!review) throw new NotFoundException('Review not found');
    return review;
  }
}
