import { pgEnum } from 'drizzle-orm/pg-core';

export const roleEnum = pgEnum('role', [
  'super_admin',
  'admin',
  'support',
  'manager',
  'customer',
]);

// Explicit enum prevents silent typos ('ACTIVE' vs 'active') from bypassing auth checks
export const userStatusEnum = pgEnum('user_status', ['active', 'suspended', 'deleted']);

export const Role = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  SUPPORT: 'support',
  MANAGER: 'manager',
  CUSTOMER: 'customer',
} as const;
export type Role = typeof Role[keyof typeof Role];

export const PLATFORM_ROLES = ['super_admin', 'admin', 'support'] as const;

export const orderStatusEnum = pgEnum('order_status', [
  'pending',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
]);

/** Separate lifecycle for payment — independent of the fulfillment status */
export const orderPaymentStatusEnum = pgEnum('order_payment_status', [
  'unpaid',
  'initiated',
  'paid',
  'refunded',
  'failed',
]);

export const paymentStatusEnum = pgEnum('payment_status', [
  'pending',
  'completed',
  'failed',
  'refunded',
]);

export const transactionTypeEnum = pgEnum('transaction_type', ['in', 'out']);
