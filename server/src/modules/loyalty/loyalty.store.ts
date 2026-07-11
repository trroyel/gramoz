import { Injectable, Inject } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, or, and, isNull, gt, sum } from 'drizzle-orm';
import { DATABASE } from '@database/database.module';
import * as schema from '@database/schema';

@Injectable()
export class LoyaltyStore {
  constructor(
    @Inject(DATABASE) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async createTransaction(
    data: typeof schema.loyaltyPoints.$inferInsert,
    tx?: any,
  ): Promise<schema.LoyaltyPoint> {
    const executor = tx || this.db;
    const [pointTransaction] = await executor
      .insert(schema.loyaltyPoints)
      .values(data)
      .returning();
    return pointTransaction;
  }

  async getAvailableBalance(userId: string, tx?: any): Promise<number> {
    const executor = tx || this.db;
    
    const [result] = await executor
      .select({ total: sum(schema.loyaltyPoints.points) })
      .from(schema.loyaltyPoints)
      .where(
        and(
          eq(schema.loyaltyPoints.userId, userId),
          or(
            isNull(schema.loyaltyPoints.validUntil),
            gt(schema.loyaltyPoints.validUntil, new Date()),
          ),
        ),
      );

    return Number(result?.total || 0);
  }

  async getTransactionHistory(userId: string, limit = 20, offset = 0) {
    return this.db.query.loyaltyPoints.findMany({
      where: eq(schema.loyaltyPoints.userId, userId),
      orderBy: (points, { desc }) => [desc(points.createdAt)],
      limit,
      offset,
    });
  }
}
