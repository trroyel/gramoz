import {
  Injectable,
  Inject,
} from '@nestjs/common';
import { EntityNotFoundError, InvalidOperationError, EntityConflictError } from '../../common/errors/domain.errors';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, desc } from 'drizzle-orm';
import { DATABASE } from '@database/database.module';
import * as schema from '@database/schema';
import { CreatePromoDto } from './dto/create-promo.dto';
import { ValidatePromoDto } from './dto/validate-promo.dto';

@Injectable()
export class PromosService {
  constructor(
    @Inject(DATABASE) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async create(dto: CreatePromoDto) {
    const codeUpper = dto.code.toUpperCase();

    // Check if code exists
    const existing = await this.db.query.promos.findFirst({
      where: eq(schema.promos.code, codeUpper),
    });

    if (existing) {
      throw new EntityConflictError('Promo code already exists');
    }

    const [promo] = await this.db
      .insert(schema.promos)
      .values({
        code: codeUpper,
        discountType: dto.discountType,
        discountValue: dto.discountValue.toString(),
        minOrderValue: dto.minOrderValue ? dto.minOrderValue.toString() : null,
        maxUses: dto.maxUses,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        isActive: dto.isActive !== undefined ? dto.isActive : true,
      })
      .returning();

    return promo;
  }

  async findAll() {
    return this.db.query.promos.findMany({
      orderBy: [desc(schema.promos.createdAt)],
    });
  }

  /**
   * Returns promos safe to display publicly:
   * isActive, not expired, not exhausted.
   */
  async findPublicActive() {
    const all = await this.db.query.promos.findMany({
      where: eq(schema.promos.isActive, true),
      orderBy: [desc(schema.promos.createdAt)],
    });
    const now = new Date();
    return all.filter((p) => {
      if (p.expiresAt && new Date(p.expiresAt) < now) return false;
      if (p.maxUses !== null && p.currentUses >= p.maxUses) return false;
      return true;
    });
  }

  async findOne(id: string) {
    const promo = await this.db.query.promos.findFirst({
      where: eq(schema.promos.id, id),
    });

    if (!promo) {
      throw new EntityNotFoundError('Promo not found');
    }
    return promo;
  }

  async toggleActive(id: string) {
    const promo = await this.findOne(id);

    const [updated] = await this.db
      .update(schema.promos)
      .set({ isActive: !promo.isActive, updatedAt: new Date() })
      .where(eq(schema.promos.id, id))
      .returning();

    return updated;
  }

  async delete(id: string) {
    const [deleted] = await this.db
      .delete(schema.promos)
      .where(eq(schema.promos.id, id))
      .returning();

    if (!deleted) {
      throw new EntityNotFoundError('Promo not found');
    }
    return deleted;
  }

  async validate(dto: ValidatePromoDto) {
    const codeUpper = dto.code.toUpperCase();

    const promo = await this.db.query.promos.findFirst({
      where: eq(schema.promos.code, codeUpper),
    });

    if (!promo) {
      throw new EntityNotFoundError('Invalid promo code');
    }

    if (!promo.isActive) {
      throw new InvalidOperationError('This promo code is no longer active');
    }

    if (promo.expiresAt && new Date() > promo.expiresAt) {
      throw new InvalidOperationError('This promo code has expired');
    }

    if (promo.maxUses && promo.currentUses >= promo.maxUses) {
      throw new InvalidOperationError(
        'This promo code has reached its maximum usage limit',
      );
    }

    if (promo.minOrderValue && dto.subtotal < Number(promo.minOrderValue)) {
      throw new InvalidOperationError(
        `This promo requires a minimum order value of ${promo.minOrderValue} ৳`,
      );
    }

    let discountAmountCents = 0;
    const subtotalCents = Math.round(dto.subtotal * 100);

    if (promo.discountType === 'percentage') {
      discountAmountCents = Math.round(
        (subtotalCents * Number(promo.discountValue)) / 100,
      );
    } else if (promo.discountType === 'fixed') {
      discountAmountCents = Math.round(Number(promo.discountValue) * 100);
    }

    // Ensure discount doesn't exceed subtotal
    discountAmountCents = Math.min(discountAmountCents, subtotalCents);
    const discountAmount = discountAmountCents / 100;

    return {
      promoId: promo.id,
      code: promo.code,
      discountType: promo.discountType,
      discountValue: Number(promo.discountValue),
      discountAmount,
    };
  }
}
