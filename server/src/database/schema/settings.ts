import { pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';

export const settings = pgTable('settings', {
  key: varchar({ length: 255 }).primaryKey(),
  value: text('value').notNull(),
  description: text('description'),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export type Setting = typeof settings.$inferSelect;
export type NewSetting = typeof settings.$inferInsert;
