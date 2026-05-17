import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and } from 'drizzle-orm';
import { DATABASE } from '@database/database.module';
import * as schema from '@database/schema';
import { AddToCartDto } from './dto/add-to-cart.dto';

@Injectable()
export class CartService {
  constructor(
    @Inject(DATABASE) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async getCart(userId: string) {
    const items = await this.db
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
      .leftJoin(schema.products, eq(schema.cartItems.productId, schema.products.id))
      .where(eq(schema.cartItems.userId, userId));

    // Calculate totals
    const subtotal = items.reduce((sum, item) => {
      return sum + parseFloat(item.productPrice ?? '0') * item.quantity;
    }, 0);

    return { items, subtotal: subtotal.toFixed(2), itemCount: items.length };
  }

  async addItem(userId: string, dto: AddToCartDto) {
    // Verify product exists and is active
    const [product] = await this.db
      .select()
      .from(schema.products)
      .where(eq(schema.products.id, dto.productId));

    if (!product) throw new NotFoundException('Product not found');
    if (product.status !== 'active')
      throw new BadRequestException('Product is not available');
    if (product.stock < dto.quantity)
      throw new BadRequestException(
        `Only ${product.stock} units available in stock`,
      );

    // If item already in cart, update quantity
    const [existing] = await this.db
      .select()
      .from(schema.cartItems)
      .where(
        and(
          eq(schema.cartItems.userId, userId),
          eq(schema.cartItems.productId, dto.productId),
        ),
      );

    if (existing) {
      const newQty = existing.quantity + dto.quantity;
      if (newQty > product.stock)
        throw new BadRequestException(
          `Cannot add more. Only ${product.stock} units available`,
        );

      const [updated] = await this.db
        .update(schema.cartItems)
        .set({ quantity: newQty, updatedAt: new Date() })
        .where(eq(schema.cartItems.id, existing.id))
        .returning();
      return updated;
    }

    // Otherwise create new cart item
    const [item] = await this.db
      .insert(schema.cartItems)
      .values({ userId, productId: dto.productId, quantity: dto.quantity })
      .returning();
    return item;
  }

  async updateItem(userId: string, cartItemId: string, quantity: number) {
    const [item] = await this.db
      .select()
      .from(schema.cartItems)
      .where(
        and(
          eq(schema.cartItems.id, cartItemId),
          eq(schema.cartItems.userId, userId),
        ),
      );

    if (!item) throw new NotFoundException('Cart item not found');

    // Check stock
    const [product] = await this.db
      .select()
      .from(schema.products)
      .where(eq(schema.products.id, item.productId));

    if (product.stock < quantity)
      throw new BadRequestException(
        `Only ${product.stock} units available in stock`,
      );

    const [updated] = await this.db
      .update(schema.cartItems)
      .set({ quantity, updatedAt: new Date() })
      .where(eq(schema.cartItems.id, cartItemId))
      .returning();

    return updated;
  }

  async removeItem(userId: string, cartItemId: string) {
    const [item] = await this.db
      .select()
      .from(schema.cartItems)
      .where(
        and(
          eq(schema.cartItems.id, cartItemId),
          eq(schema.cartItems.userId, userId),
        ),
      );

    if (!item) throw new NotFoundException('Cart item not found');

    await this.db
      .delete(schema.cartItems)
      .where(eq(schema.cartItems.id, cartItemId));
  }

  async clearCart(userId: string) {
    await this.db
      .delete(schema.cartItems)
      .where(eq(schema.cartItems.userId, userId));
  }
}
