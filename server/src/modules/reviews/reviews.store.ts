/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import { Injectable, Inject } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and, sql } from 'drizzle-orm';
import { DATABASE } from '@database/database.module';
import * as schema from '@database/schema';

@Injectable()
export class ReviewsStore {
  constructor(
    @Inject(DATABASE) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async runTransaction<T>(cb: (tx: any) => Promise<T>): Promise<T> {
    return await this.db.transaction(cb);
  }

  async createReview(
    data: typeof schema.reviews.$inferInsert,
    tx?: any,
  ): Promise<schema.Review> {
    const executor = tx || this.db;
    const [review] = await executor
      .insert(schema.reviews)
      .values(data)
      .returning();
    return review;
  }

  async getReviewByUserAndProductAndOrder(
    userId: string,
    productId: string,
    orderId: string,
    tx?: any,
  ): Promise<schema.Review | null> {
    const executor = tx || this.db;
    const [review] = await executor
      .select()
      .from(schema.reviews)
      .where(
        and(
          eq(schema.reviews.userId, userId),
          eq(schema.reviews.productId, productId),
          eq(schema.reviews.orderId, orderId),
        ),
      );
    return review || null;
  }

  async getProductReviews(productId: string, limit = 10, offset = 0) {
    return this.db.query.reviews.findMany({
      where: and(
        eq(schema.reviews.productId, productId),
        eq(schema.reviews.status, 'approved'),
      ),
      orderBy: (reviews, { desc }) => [desc(reviews.createdAt)],
      limit,
      offset,
      with: {
        user: {
          columns: {
            fullName: true,
          },
        },
      },
    });
  }

  async getProductReviewStats(
    productId: string,
  ): Promise<{ averageRating: number; reviewCount: number }> {
    const [stats] = await this.db
      .select({
        averageRating: sql<number>`COALESCE(ROUND(AVG(${schema.reviews.rating})::numeric, 2), 0)::float`,
        reviewCount: sql<number>`COUNT(*)::int`,
      })
      .from(schema.reviews)
      .where(
        and(
          eq(schema.reviews.productId, productId),
          eq(schema.reviews.status, 'approved'),
        ),
      );
    return stats || { averageRating: 0, reviewCount: 0 };
  }

  async getReviewById(id: string): Promise<schema.Review | null> {
    const [review] = await this.db
      .select()
      .from(schema.reviews)
      .where(eq(schema.reviews.id, id));
    return review || null;
  }

  async findAllForAdmin(limit = 20, offset = 0) {
    return this.db.query.reviews.findMany({
      limit,
      offset,
      orderBy: (reviews, { desc }) => [desc(reviews.createdAt)],
      with: {
        user: {
          columns: {
            fullName: true,
            email: true,
          },
        },
        product: {
          columns: {
            name: true,
          },
        },
      },
    });
  }

  async updateStatus(id: string, status: 'pending' | 'approved' | 'rejected') {
    const [review] = await this.db
      .update(schema.reviews)
      .set({ status })
      .where(eq(schema.reviews.id, id))
      .returning();
    return review;
  }

  async getProductById(productId: string) {
    const [product] = await this.db
      .select({
        id: schema.products.id,
        status: schema.products.status,
        deletedAt: schema.products.deletedAt,
      })
      .from(schema.products)
      .where(eq(schema.products.id, productId));
    return product || null;
  }

  async getReviewsByUser(userId: string, limit = 10, offset = 0) {
    return this.db.query.reviews.findMany({
      where: eq(schema.reviews.userId, userId),
      orderBy: (reviews, { desc }) => [desc(reviews.createdAt)],
      limit,
      offset,
      with: {
        product: {
          columns: {
            id: true,
            name: true,
            images: true,
          },
        },
      },
    });
  }

  async updateUserReview(
    id: string,
    userId: string,
    data: { rating?: number; comment?: string; images?: string[] },
  ) {
    const [review] = await this.db
      .update(schema.reviews)
      .set({
        ...data,
        status: 'pending',
        updatedAt: new Date(),
      })
      .where(and(eq(schema.reviews.id, id), eq(schema.reviews.userId, userId)))
      .returning();
    return review || null;
  }

  async deleteUserReview(id: string, userId: string) {
    const [review] = await this.db
      .delete(schema.reviews)
      .where(and(eq(schema.reviews.id, id), eq(schema.reviews.userId, userId)))
      .returning();
    return review || null;
  }

  async deleteReview(id: string) {
    const [review] = await this.db
      .delete(schema.reviews)
      .where(eq(schema.reviews.id, id))
      .returning();
    return review || null;
  }
}
