import { Injectable } from '@nestjs/common';
import {
  EntityNotFoundError,
  InvalidOperationError,
  InsufficientStockError,
} from '../../common/errors/domain.errors';
import * as schema from '@database/schema';
import { AddToCartDto } from './dto/add-to-cart.dto';
import { CartStore, CartItemWithProduct } from './cart.store';

export type CartSummary = {
  items: CartItemWithProduct[];
  subtotal: string;
  itemCount: number;
};

@Injectable()
export class CartService {
  constructor(private readonly cartStore: CartStore) {}

  async getCart(userId: string): Promise<CartSummary> {
    const items = await this.cartStore.getCartItemsWithProducts(userId);

    // Calculate totals
    const subtotal = items.reduce((sum, item) => {
      const price = parseFloat(item.variantPrice ?? item.productPrice ?? '0');
      return sum + price * item.quantity;
    }, 0);

    return {
      items,
      subtotal: subtotal.toFixed(2),
      itemCount: items.length,
    };
  }

  async addItem(userId: string, dto: AddToCartDto): Promise<schema.CartItem> {
    if (!dto.quantity || dto.quantity <= 0 || !Number.isInteger(dto.quantity)) {
      throw new InvalidOperationError('Quantity must be a positive integer');
    }

    // Verify product exists and is active
    const product = await this.cartStore.getProductById(dto.productId);

    if (!product) throw new EntityNotFoundError('Product not found');
    if (product.status !== 'active')
      throw new InvalidOperationError('Product is not available');

    let maxStock = product.stock;
    if (dto.variantId) {
      const variant = await this.cartStore.getVariantById(dto.variantId);
      if (!variant) throw new EntityNotFoundError('Variant not found');
      if (variant.productId !== product.id)
        throw new InvalidOperationError('Variant does not belong to product');
      maxStock = variant.stock;
    }

    if (maxStock < dto.quantity)
      throw new InsufficientStockError(
        `Only ${maxStock} units available in stock`,
      );

    // Atomic upsert with concurrency protection and stock ceiling
    const item = await this.cartStore.upsertCartItem(
      {
        userId,
        productId: dto.productId,
        variantId: dto.variantId ?? null,
        quantity: dto.quantity,
      },
      maxStock,
    );

    if (!item) {
      throw new InsufficientStockError(
        `Cannot add more. Only ${maxStock} units available`,
      );
    }

    return item;
  }

  async updateItem(
    userId: string,
    cartItemId: string,
    quantity: number,
  ): Promise<schema.CartItem> {
    if (!quantity || quantity <= 0 || !Number.isInteger(quantity)) {
      throw new InvalidOperationError('Quantity must be a positive integer');
    }

    const item = await this.cartStore.findCartItemById(cartItemId, userId);

    if (!item) throw new EntityNotFoundError('Cart item not found');

    // Check stock
    const product = await this.cartStore.getProductById(item.productId);

    if (!product) throw new EntityNotFoundError('Product not found');

    let maxStock = product.stock;
    if (item.variantId) {
      const variant = await this.cartStore.getVariantById(item.variantId);
      if (variant) {
        maxStock = variant.stock;
      }
    }

    if (maxStock < quantity)
      throw new InsufficientStockError(
        `Only ${maxStock} units available in stock`,
      );

    return await this.cartStore.updateCartItemQuantity(
      cartItemId,
      quantity,
      userId,
    );
  }

  async removeItem(userId: string, cartItemId: string): Promise<void> {
    const item = await this.cartStore.findCartItemById(cartItemId, userId);

    if (!item) throw new EntityNotFoundError('Cart item not found');

    await this.cartStore.deleteCartItem(cartItemId, userId);
  }

  async clearCart(userId: string): Promise<void> {
    await this.cartStore.deleteCartByUserId(userId);
  }
}
