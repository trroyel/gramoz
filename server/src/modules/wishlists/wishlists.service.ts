import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import { WishlistsStore } from './wishlists.store';

@Injectable()
export class WishlistsService {
  constructor(private readonly store: WishlistsStore) {}

  async add(userId: string, productId: string) {
    if (!productId || !isUUID(productId)) {
      throw new BadRequestException('Invalid product ID');
    }

    const product = await this.store.getProductById(productId);
    if (!product || product.deletedAt || product.status === 'archived') {
      throw new NotFoundException('Product not found or unavailable');
    }

    try {
      await this.store.add(userId, productId);
      return { success: true, message: 'Added to wishlist' };
    } catch (e: unknown) {
      if ((e as { code?: string })?.code === '23503') {
        throw new NotFoundException('Product not found');
      }
      throw new BadRequestException('Could not add to wishlist');
    }
  }

  async remove(userId: string, productId: string) {
    if (!productId || !isUUID(productId)) {
      throw new BadRequestException('Invalid product ID');
    }

    await this.store.remove(userId, productId);
    return { success: true, message: 'Removed from wishlist' };
  }

  async findByUser(userId: string) {
    return this.store.findByUser(userId);
  }

  async check(userId: string, productId: string) {
    if (!productId || !isUUID(productId)) {
      return { isFavorited: false };
    }
    const isFavorited = await this.store.check(userId, productId);
    return { isFavorited };
  }
}
