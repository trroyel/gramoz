import {
  pgTable,
  timestamp,
  uuid,
  integer,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users';
import { pointTransactionTypeEnum } from './enums';

export const loyaltyPoints = pgTable('loyalty_points', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  points: integer('points').notNull(),
  type: pointTransactionTypeEnum('type').notNull(),
  referenceId: uuid('reference_id'), // can link to review.id or order.id
  validUntil: timestamp('valid_until'), // null = never expires
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const loyaltyPointsRelations = relations(loyaltyPoints, ({ one }) => ({
  user: one(users, {
    fields: [loyaltyPoints.userId],
    references: [users.id],
  }),
}));

export type LoyaltyPoint = typeof loyaltyPoints.$inferSelect;
export type NewLoyaltyPoint = typeof loyaltyPoints.$inferInsert;
