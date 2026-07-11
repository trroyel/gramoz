import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { WishlistsStore } from './wishlists.store';

@Injectable()
export class WishlistsService {
  constructor(private readonly store: WishlistsStore) {}

  async add(userId: string, productId: string) {
    try {
      await this.store.add(userId, productId);
      return { success: true, message: 'Added to wishlist' };
    } catch (e: any) {
      if (e.code === '23503') { // Postgres foreign key violation
        throw new NotFoundException('Product not found');
      }
      throw new BadRequestException('Could not add to wishlist');
    }
  }

  async remove(userId: string, productId: string) {
    const removed = await this.store.remove(userId, productId);
    if (!removed) {
      throw new NotFoundException('Product is not in wishlist');
    }
    return { success: true, message: 'Removed from wishlist' };
  }

  async findByUser(userId: string) {
    return this.store.findByUser(userId);
  }

  async check(userId: string, productId: string) {
    const isFavorited = await this.store.check(userId, productId);
    return { isFavorited };
  }
}
