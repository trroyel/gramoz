import { Injectable, Inject } from '@nestjs/common';
import { EntityNotFoundError } from '../../common/errors/domain.errors';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  eq,
  ilike,
  and,
  gte,
  lte,
  desc,
  asc,
  isNull,
  SQL,
  or,
  sql,
} from 'drizzle-orm';
import { DATABASE } from '@database/database.module';
import * as schema from '@database/schema';
import { CreateProductDto } from './dto/create-product.dto';
import { RedisService } from '../../cache/redis.service';

/** Matches the standard xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx UUID format */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ProductWithCategory = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  price: string;
  stock: number;
  unit: string | null;
  images: any;
  status: string | null;
  categoryId: string | null;
  categoryName: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

@Injectable()
export class ProductsService {
  constructor(
    @Inject(DATABASE) private readonly db: NodePgDatabase<typeof schema>,
    private readonly redisService: RedisService,
  ) {}

  async create(
    createProductDto: CreateProductDto,
    imageUrl?: string,
  ): Promise<schema.Product> {
    const slug = createProductDto.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '');
    const uniqueSlug = `${slug}-${Date.now()}`;

    const newProduct: schema.NewProduct = {
      name: createProductDto.name,
      slug: uniqueSlug,
      description: createProductDto.description,
      price: createProductDto.price.toString(),
      stock: createProductDto.stock,
      unit: createProductDto.unit ?? 'piece',
      categoryId: createProductDto.categoryId,
      images: imageUrl ? [{ url: imageUrl }] : [],
    };

    const [product] = await this.db
      .insert(schema.products)
      .values(newProduct)
      .returning();
    return product;
  }

  async findAll(query?: {
    q?: string;
    category?: string;
    inStock?: string;
    minPrice?: string;
    maxPrice?: string;
    sort?: string;
    page?: string;
    limit?: string;
  }): Promise<{ data: ProductWithCategory[]; meta: { total: number; page: number; limit: number; totalPages: number } }> {
    // Always exclude soft-deleted and non-active products from the shop listing
    const conditions: SQL[] = [
      isNull(schema.products.deletedAt),
      eq(schema.products.status, 'active'),
    ];

    if (query?.q) {
      conditions.push(ilike(schema.products.name, `%${query.q}%`));
    }
    if (query?.category && query.category !== 'All') {
      if (UUID_RE.test(query.category)) {
        // Frontend passed a proper UUID — filter by categoryId directly
        conditions.push(eq(schema.products.categoryId, query.category));
      } else {
        // Fallback: treat as category name or slug (case-insensitive)
        conditions.push(
          or(
            ilike(schema.categories.name, query.category),
            ilike(schema.categories.slug, query.category),
          )!,
        );
      }
    }
    if (query?.inStock === 'true') {
      conditions.push(gte(schema.products.stock, 1));
    }
    if (query?.minPrice) {
      conditions.push(gte(schema.products.price, query.minPrice));
    }
    if (query?.maxPrice) {
      conditions.push(lte(schema.products.price, query.maxPrice));
    }

    // Pagination
    const page = Math.max(1, parseInt(query?.page ?? '1', 10));
    const limit = Math.min(
      100,
      Math.max(1, parseInt(query?.limit ?? '20', 10)),
    );
    const offset = (page - 1) * limit;

    const orderBy =
      query?.sort === 'price_asc'
        ? asc(schema.products.price)
        : query?.sort === 'price_desc'
          ? desc(schema.products.price)
          : desc(schema.products.createdAt);

    // Run data and count queries in parallel
    const [data, countResult] = await Promise.all([
      this.db
        .select({
          id: schema.products.id,
          name: schema.products.name,
          slug: schema.products.slug,
          description: schema.products.description,
          price: schema.products.price,
          stock: schema.products.stock,
          unit: schema.products.unit,
          images: schema.products.images,
          status: schema.products.status,
          categoryId: schema.products.categoryId,
          categoryName: schema.categories.name,
          createdAt: schema.products.createdAt,
          updatedAt: schema.products.updatedAt,
        })
        .from(schema.products)
        .leftJoin(
          schema.categories,
          eq(schema.products.categoryId, schema.categories.id),
        )
        .where(and(...conditions))
        .orderBy(orderBy)
        .limit(limit)
        .offset(offset),

      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.products)
        .leftJoin(
          schema.categories,
          eq(schema.products.categoryId, schema.categories.id),
        )
        .where(and(...conditions)),
    ]);

    const total = Number(countResult[0]?.count ?? 0);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string): Promise<ProductWithCategory | undefined> {
    const cacheKey = `product:${id}`;
    const cached = await this.redisService.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const [product] = await this.db
      .select({
        id: schema.products.id,
        name: schema.products.name,
        slug: schema.products.slug,
        description: schema.products.description,
        price: schema.products.price,
        stock: schema.products.stock,
        unit: schema.products.unit,
        images: schema.products.images,
        status: schema.products.status,
        categoryId: schema.products.categoryId,
        categoryName: schema.categories.name,
        createdAt: schema.products.createdAt,
        updatedAt: schema.products.updatedAt,
      })
      .from(schema.products)
      .leftJoin(
        schema.categories,
        eq(schema.products.categoryId, schema.categories.id),
      )
      .where(
        and(
          eq(schema.products.id, id),
          isNull(schema.products.deletedAt), // exclude soft-deleted
        ),
      );

    if (product) {
      // Cache for 5 minutes (300 seconds)
      await this.redisService.set(cacheKey, JSON.stringify(product), 300);
    }
    
    return product;
  }

  async update(
    id: string,
    data: Partial<CreateProductDto>,
    imageUrl?: string,
  ): Promise<schema.Product> {
    const updateData: Partial<schema.NewProduct> = {};
    if (data.name) updateData.name = data.name;
    if (data.description !== undefined)
      updateData.description = data.description;
    if (data.price !== undefined) updateData.price = data.price.toString();
    if (data.stock !== undefined) updateData.stock = data.stock;
    if (data.categoryId !== undefined) updateData.categoryId = data.categoryId;
    if (data.unit !== undefined) updateData.unit = data.unit;
    if (imageUrl !== undefined)
      updateData.images = imageUrl ? [{ url: imageUrl }] : [];

    const [product] = await this.db
      .update(schema.products)
      .set({ ...updateData, updatedAt: new Date() })
      .where(eq(schema.products.id, id))
      .returning();

    // Invalidate the specific product cache
    await this.redisService.del(`product:${id}`);

    return product;
  }

  async delete(id: string): Promise<schema.Product> {
    // Soft-delete: set deletedAt and archive the product instead of hard-deleting.
    // This preserves historical order_items references and avoids FK violations.
    // Hard DELETE would break order history for any customer who bought this product.
    const [product] = await this.db
      .update(schema.products)
      .set({
        deletedAt: new Date(),
        status: 'archived',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.products.id, id),
          isNull(schema.products.deletedAt), // prevent double-delete
        ),
      )
      .returning();

    if (!product) {
      throw new EntityNotFoundError('Product not found or already deleted');
    }

    // Invalidate the specific product cache
    await this.redisService.del(`product:${id}`);

    return product;
  }
}
