import { Injectable, Inject } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE } from '@database/database.module';
import * as schema from '@database/schema';
import { and, eq } from 'drizzle-orm';

@Injectable()
export class WishlistsStore {
  constructor(
    @Inject(DATABASE) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async add(userId: string, productId: string) {
    const [wishlist] = await this.db
      .insert(schema.wishlists)
      .values({ userId, productId })
      .onConflictDoNothing()
      .returning();
    return wishlist;
  }

  async remove(userId: string, productId: string) {
    const [wishlist] = await this.db
      .delete(schema.wishlists)
      .where(
        and(
          eq(schema.wishlists.userId, userId),
          eq(schema.wishlists.productId, productId),
        ),
      )
      .returning();
    return wishlist;
  }

  async findByUser(userId: string) {
    const list = await this.db.query.wishlists.findMany({
      where: eq(schema.wishlists.userId, userId),
      with: {
        product: true,
      },
      orderBy: (wishlists, { desc }) => [desc(wishlists.createdAt)],
    });

    // Exclude wishlisted items where the product has been soft-deleted or archived
    return list.filter(
      (item) =>
        item.product &&
        !item.product.deletedAt &&
        item.product.status !== 'archived',
    );
  }

  async check(userId: string, productId: string) {
    const result = await this.db.query.wishlists.findFirst({
      where: and(
        eq(schema.wishlists.userId, userId),
        eq(schema.wishlists.productId, productId),
      ),
    });
    return !!result;
  }

  async getProductById(productId: string) {
    const [product] = await this.db
      .select({
        id: schema.products.id,
        status: schema.products.status,
        deletedAt: schema.products.deletedAt,
      })
      .from(schema.products)
      .where(eq(schema.products.id, productId));
    return product || null;
  }
}
