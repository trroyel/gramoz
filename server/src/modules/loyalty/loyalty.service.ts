import { Injectable, BadRequestException } from '@nestjs/common';
import { LoyaltyStore } from './loyalty.store';
import { SettingsService } from '../settings/settings.service';
import { pointTransactionTypeEnum } from '@database/schema/enums';

@Injectable()
export class LoyaltyService {
  constructor(
    private readonly loyaltyStore: LoyaltyStore,
    private readonly settingsService: SettingsService,
  ) {}

  async awardPoints(
    userId: string,
    points: number,
    type: (typeof pointTransactionTypeEnum.enumValues)[number],
    referenceId?: string,
    tx?: any,
  ) {
    if (points <= 0) {
      throw new BadRequestException(
        'Points to award must be greater than zero',
      );
    }

    if (
      referenceId &&
      typeof this.loyaltyStore.hasPointsBeenAwarded === 'function'
    ) {
      const alreadyAwarded = await this.loyaltyStore.hasPointsBeenAwarded(
        referenceId,
        type,
        tx,
      );
      if (alreadyAwarded) {
        return null;
      }
    }

    const validityDays = await this.settingsService.getPointsValidityDays();
    let validUntil: Date | null = null;

    if (validityDays > 0) {
      validUntil = new Date();
      validUntil.setDate(validUntil.getDate() + validityDays);
    }

    try {
      return await this.loyaltyStore.createTransaction(
        {
          userId,
          points,
          type,
          referenceId,
          validUntil,
        },
        tx,
      );
    } catch (err: unknown) {
      const error = err as { code?: string; message?: string };
      if (
        error?.code === '23505' ||
        error?.message?.includes('idx_loyalty_points_review_reward_unique')
      ) {
        return null;
      }
      throw err;
    }
  }

  async spendPoints(
    userId: string,
    pointsToSpend: number,
    referenceId?: string,
    tx?: any,
  ) {
    if (pointsToSpend <= 0) {
      throw new BadRequestException(
        'Points to spend must be greater than zero',
      );
    }

    // Acquire exclusive row lock on the user to prevent concurrent double-spending
    await this.loyaltyStore.lockUserForLoyalty(userId, tx);

    const currentBalance = await this.loyaltyStore.getAvailableBalance(
      userId,
      tx,
    );

    if (currentBalance < pointsToSpend) {
      throw new BadRequestException(
        `Insufficient points balance. Available: ${currentBalance}`,
      );
    }

    // Points spent don't expire, they are an immediate deduction.
    return this.loyaltyStore.createTransaction(
      {
        userId,
        points: -pointsToSpend,
        type: 'spent_checkout',
        referenceId,
        validUntil: null,
      },
      tx,
    );
  }

  async refundPoints(
    userId: string,
    pointsToRefund: number,
    referenceId?: string,
    tx?: any,
  ) {
    if (pointsToRefund <= 0) return;

    if (referenceId) {
      const alreadyRefunded = await this.loyaltyStore.hasPointsBeenRefunded(
        referenceId,
        tx,
      );
      if (alreadyRefunded) {
        return;
      }
    }

    return this.loyaltyStore.createTransaction(
      {
        userId,
        points: pointsToRefund,
        type: 'admin_adjustment',
        referenceId,
        validUntil: null,
      },
      tx,
    );
  }

  async getBalance(userId: string) {
    return this.loyaltyStore.getAvailableBalance(userId);
  }

  async getHistory(userId: string, page = 1, limit = 20) {
    const offset = (Math.max(1, page) - 1) * limit;
    return this.loyaltyStore.getTransactionHistory(userId, limit, offset);
  }
}
