import { Injectable, Inject } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and } from 'drizzle-orm';
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
      limit,
      offset,
      with: {
        user: {
          columns: {
            fullName: true,
          }
        }
      }
    });
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
          }
        }
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

  async deleteReview(id: string) {
    const [review] = await this.db
      .delete(schema.reviews)
      .where(eq(schema.reviews.id, id))
      .returning();
    return review;
  }
}
