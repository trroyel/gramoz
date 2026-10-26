import {
  pgTable,
  timestamp,
  uuid,
  integer,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { users } from './users';
import { pointTransactionTypeEnum } from './enums';

export const loyaltyPoints = pgTable(
  'loyalty_points',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    points: integer('points').notNull(),
    type: pointTransactionTypeEnum('type').notNull(),
    referenceId: uuid('reference_id'), // can link to review.id, order.id, or order_item.id
    validUntil: timestamp('valid_until'), // null = never expires
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_loyalty_points_user_id').on(table.userId, table.createdAt),
    index('idx_loyalty_points_reference_id').on(table.referenceId),
    uniqueIndex('idx_loyalty_points_review_reward_unique')
      .on(table.referenceId)
      .where(
        sql`type IN ('earned_review_text', 'earned_review_media') AND reference_id IS NOT NULL`,
      ),
  ],
);

export const loyaltyPointsRelations = relations(loyaltyPoints, ({ one }) => ({
  user: one(users, {
    fields: [loyaltyPoints.userId],
    references: [users.id],
  }),
}));

export type LoyaltyPoint = typeof loyaltyPoints.$inferSelect;
export type NewLoyaltyPoint = typeof loyaltyPoints.$inferInsert;
