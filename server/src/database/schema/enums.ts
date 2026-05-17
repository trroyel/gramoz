import { pgEnum } from 'drizzle-orm/pg-core';

export const roleEnum = pgEnum('role', [
  'super_admin',
  'admin',
  'support',
  'seller',
  'customer',
]);

export const PLATFORM_ROLES = ['super_admin', 'admin', 'support'] as const;

export const orderStatusEnum = pgEnum('order_status', [
  'pending',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
]);

export const paymentStatusEnum = pgEnum('payment_status', [
  'pending',
  'completed',
  'failed',
  'refunded',
]);

export const transactionTypeEnum = pgEnum('transaction_type', ['in', 'out']);
