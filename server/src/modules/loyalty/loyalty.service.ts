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
    type: typeof pointTransactionTypeEnum.enumValues[number],
    referenceId?: string,
    tx?: any,
  ) {
    if (points <= 0) {
      throw new BadRequestException('Points to award must be greater than zero');
    }

    const validityDays = await this.settingsService.getPointsValidityDays();
    let validUntil: Date | null = null;
    
    if (validityDays > 0) {
      validUntil = new Date();
      validUntil.setDate(validUntil.getDate() + validityDays);
    }

    return this.loyaltyStore.createTransaction(
      {
        userId,
        points,
        type,
        referenceId,
        validUntil,
      },
      tx,
    );
  }

  async spendPoints(
    userId: string,
    pointsToSpend: number,
    referenceId?: string,
    tx?: any,
  ) {
    if (pointsToSpend <= 0) {
      throw new BadRequestException('Points to spend must be greater than zero');
    }

    const currentBalance = await this.loyaltyStore.getAvailableBalance(userId, tx);

    if (currentBalance < pointsToSpend) {
      throw new BadRequestException(`Insufficient points balance. Available: ${currentBalance}`);
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

  async getBalance(userId: string) {
    return this.loyaltyStore.getAvailableBalance(userId);
  }

  async getHistory(userId: string, page = 1, limit = 20) {
    const offset = (Math.max(1, page) - 1) * limit;
    return this.loyaltyStore.getTransactionHistory(userId, limit, offset);
  }
}
