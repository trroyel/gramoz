/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { Injectable, Inject } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, or, and, isNull, gt, sum, sql, inArray } from 'drizzle-orm';
import { DATABASE } from '@database/database.module';
import * as schema from '@database/schema';

@Injectable()
export class LoyaltyStore {
  constructor(
    @Inject(DATABASE) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async lockUserForLoyalty(userId: string, tx?: any): Promise<void> {
    const executor = tx || this.db;
    await executor.execute(
      sql`SELECT id FROM ${schema.users} WHERE id = ${userId} FOR UPDATE`,
    );
  }

  async createTransaction(
    data: typeof schema.loyaltyPoints.$inferInsert,
    tx?: any,
  ): Promise<schema.LoyaltyPoint | null> {
    const executor = tx || this.db;
    const isReviewReward =
      (data.type === 'earned_review_text' ||
        data.type === 'earned_review_media') &&
      Boolean(data.referenceId);

    if (isReviewReward) {
      const [pointTransaction] = await executor
        .insert(schema.loyaltyPoints)
        .values(data)
        .onConflictDoNothing({
          target: schema.loyaltyPoints.referenceId,
          where: sql`type IN ('earned_review_text', 'earned_review_media') AND reference_id IS NOT NULL`,
        })
        .returning();
      return pointTransaction || null;
    }

    const [pointTransaction] = await executor
      .insert(schema.loyaltyPoints)
      .values(data)
      .returning();
    return pointTransaction || null;
  }

  async getAvailableBalance(userId: string, tx?: any): Promise<number> {
    const executor = tx || this.db;

    // 1. Total lifetime balance across all transactions (earned + spent + refunded)
    const [allResult] = await executor
      .select({ total: sum(schema.loyaltyPoints.points) })
      .from(schema.loyaltyPoints)
      .where(eq(schema.loyaltyPoints.userId, userId));

    const totalNetBalance = Number(allResult?.total || 0);
    if (totalNetBalance <= 0) {
      return 0;
    }

    // 2. Total active unexpired positive points earned/adjusted
    const [validEarnedResult] = await executor
      .select({ total: sum(schema.loyaltyPoints.points) })
      .from(schema.loyaltyPoints)
      .where(
        and(
          eq(schema.loyaltyPoints.userId, userId),
          gt(schema.loyaltyPoints.points, 0),
          or(
            isNull(schema.loyaltyPoints.validUntil),
            gt(schema.loyaltyPoints.validUntil, new Date()),
          ),
        ),
      );

    const validEarnedPoints = Number(validEarnedResult?.total || 0);

    // Available balance is capped by both active unexpired earned points and total net balance.
    // It can never drop below 0.
    return Math.max(0, Math.min(validEarnedPoints, totalNetBalance));
  }

  async hasPointsBeenRefunded(referenceId: string, tx?: any): Promise<boolean> {
    const executor = tx || this.db;
    const [result] = await executor
      .select({ count: sql<string>`count(*)` })
      .from(schema.loyaltyPoints)
      .where(
        and(
          eq(schema.loyaltyPoints.referenceId, referenceId),
          eq(schema.loyaltyPoints.type, 'admin_adjustment'),
          sql`${schema.loyaltyPoints.points} > 0`,
        ),
      );
    return parseInt(result?.count || '0', 10) > 0;
  }

  async hasPointsBeenAwarded(
    referenceId: string,
    type: (typeof schema.pointTransactionTypeEnum.enumValues)[number],
    tx?: any,
  ): Promise<boolean> {
    const executor = tx || this.db;
    const isReview =
      type === 'earned_review_text' || type === 'earned_review_media';
    const typeCondition = isReview
      ? inArray(schema.loyaltyPoints.type, [
          'earned_review_text',
          'earned_review_media',
        ])
      : eq(schema.loyaltyPoints.type, type);

    const [result] = await executor
      .select({ count: sql<string>`count(*)` })
      .from(schema.loyaltyPoints)
      .where(
        and(
          eq(schema.loyaltyPoints.referenceId, referenceId),
          typeCondition,
          sql`${schema.loyaltyPoints.points} > 0`,
        ),
      );
    return parseInt(result?.count || '0', 10) > 0;
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
