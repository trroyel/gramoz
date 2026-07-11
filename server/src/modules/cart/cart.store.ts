import { Injectable, Inject } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and } from 'drizzle-orm';
import { DATABASE } from '@database/database.module';
import * as schema from '@database/schema';

@Injectable()
export class CartStore {
  constructor(
    @Inject(DATABASE) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async getCartItemsWithProducts(userId: string, tx?: any) {
    const executor = tx || this.db;
    return await executor
      .select({
        id: schema.cartItems.id,
        quantity: schema.cartItems.quantity,
        productId: schema.products.id,
        productName: schema.products.name,
        productPrice: schema.products.price,
        productImages: schema.products.images,
        productStock: schema.products.stock,
        productStatus: schema.products.status,
      })
      .from(schema.cartItems)
      .leftJoin(
        schema.products,
        eq(schema.cartItems.productId, schema.products.id),
      )
      .where(eq(schema.cartItems.userId, userId));
  }

  async getProductById(productId: string, tx?: any): Promise<schema.Product | null> {
    const executor = tx || this.db;
    const [product] = await executor
      .select()
      .from(schema.products)
      .where(eq(schema.products.id, productId));
    return product || null;
  }

  async findCartItemByProduct(userId: string, productId: string, tx?: any): Promise<schema.CartItem | null> {
    const executor = tx || this.db;
    const [existing] = await executor
      .select()
      .from(schema.cartItems)
      .where(
        and(
          eq(schema.cartItems.userId, userId),
          eq(schema.cartItems.productId, productId),
        ),
      );
    return existing || null;
  }

  async findCartItemById(cartItemId: string, userId: string, tx?: any): Promise<schema.CartItem | null> {
    const executor = tx || this.db;
    const [item] = await executor
      .select()
      .from(schema.cartItems)
      .where(
        and(
          eq(schema.cartItems.id, cartItemId),
          eq(schema.cartItems.userId, userId),
        ),
      );
    return item || null;
  }

  async updateCartItemQuantity(cartItemId: string, quantity: number, tx?: any): Promise<schema.CartItem> {
    const executor = tx || this.db;
    const [updated] = await executor
      .update(schema.cartItems)
      .set({ quantity, updatedAt: new Date() })
      .where(eq(schema.cartItems.id, cartItemId))
      .returning();
    return updated;
  }

  async createCartItem(data: typeof schema.cartItems.$inferInsert, tx?: any): Promise<schema.CartItem> {
    const executor = tx || this.db;
    const [item] = await executor
      .insert(schema.cartItems)
      .values(data)
      .returning();
    return item;
  }

  async deleteCartItem(cartItemId: string, tx?: any): Promise<void> {
    const executor = tx || this.db;
    await executor
      .delete(schema.cartItems)
      .where(eq(schema.cartItems.id, cartItemId));
  }

  async deleteCartByUserId(userId: string, tx?: any): Promise<void> {
    const executor = tx || this.db;
    await executor
      .delete(schema.cartItems)
      .where(eq(schema.cartItems.userId, userId));
  }
}
