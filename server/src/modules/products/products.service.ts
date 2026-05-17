import { Injectable, Inject } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, ilike, and, gte, lte, desc, asc } from 'drizzle-orm';
import { DATABASE } from '@database/database.module';
import * as schema from '@database/schema';
import { CreateProductDto } from './dto/create-product.dto';

@Injectable()
export class ProductsService {
  constructor(
    @Inject(DATABASE) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async create(createProductDto: CreateProductDto, imageUrl?: string) {
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
      categoryId: createProductDto.categoryId,
      images: imageUrl ? [{ url: imageUrl }] : [],
    };

    const [product] = await this.db
      .insert(schema.products)
      .values(newProduct)
      .returning();
    return product;
  }

  async findAll(query?: any) {
    let qb = this.db.select().from(schema.products);

    const conditions = [];

    if (query?.q) {
      conditions.push(ilike(schema.products.name, `%${query.q}%`));
    }
    if (query?.category && query.category !== 'All') {
      conditions.push(eq(schema.products.categoryId, query.category));
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

    if (conditions.length > 0) {
      // @ts-ignore
      qb = qb.where(and(...conditions));
    }

    if (query?.sort === 'price_asc') {
      // @ts-ignore
      qb = qb.orderBy(asc(schema.products.price));
    } else if (query?.sort === 'price_desc') {
      // @ts-ignore
      qb = qb.orderBy(desc(schema.products.price));
    } else {
      // @ts-ignore
      qb = qb.orderBy(desc(schema.products.createdAt));
    }

    return qb;
  }

  async findOne(id: string) {
    const [product] = await this.db
      .select({
        id: schema.products.id,
        name: schema.products.name,
        slug: schema.products.slug,
        description: schema.products.description,
        price: schema.products.price,
        stock: schema.products.stock,
        images: schema.products.images,
        status: schema.products.status,
        categoryId: schema.products.categoryId,
        categoryName: schema.categories.name,
        createdAt: schema.products.createdAt,
        updatedAt: schema.products.updatedAt,
      })
      .from(schema.products)
      .leftJoin(schema.categories, eq(schema.products.categoryId, schema.categories.id))
      .where(eq(schema.products.id, id));
    return product;
  }

  async update(id: string, data: Partial<CreateProductDto>, imageUrl?: string) {
    const updateData: Partial<schema.NewProduct> = {};
    if (data.name) updateData.name = data.name;
    if (data.description !== undefined)
      updateData.description = data.description;
    if (data.price !== undefined) updateData.price = data.price.toString();
    if (data.stock !== undefined) updateData.stock = data.stock;
    if (data.categoryId !== undefined) updateData.categoryId = data.categoryId;
    if (imageUrl !== undefined) updateData.images = imageUrl ? [{ url: imageUrl }] : [];

    const [product] = await this.db
      .update(schema.products)
      .set({ ...updateData, updatedAt: new Date() })
      .where(eq(schema.products.id, id))
      .returning();
    return product;
  }

  async delete(id: string) {
    const [product] = await this.db
      .delete(schema.products)
      .where(eq(schema.products.id, id))
      .returning();
    return product;
  }
}
