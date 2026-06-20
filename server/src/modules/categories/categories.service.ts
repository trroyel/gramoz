import {
  Injectable,
  Inject,
} from '@nestjs/common';
import { EntityNotFoundError, EntityConflictError } from '../../common/errors/domain.errors';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { DATABASE } from '@database/database.module';
import * as schema from '@database/schema';
import { CreateCategoryDto } from './dto/create-category.dto';
import { RedisService } from '@cache/redis.service';

@Injectable()
export class CategoriesService {
  constructor(
    @Inject(DATABASE) private readonly db: NodePgDatabase<typeof schema>,
    private readonly redisService: RedisService,
  ) {}

  async create(dto: CreateCategoryDto): Promise<schema.Category> {
    const slug = dto.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '');

    // Check for duplicate slug
    const existing = await this.db
      .select()
      .from(schema.categories)
      .where(eq(schema.categories.slug, slug));

    if (existing.length > 0) {
      throw new EntityConflictError(
        `Category with name "${dto.name}" already exists`,
      );
    }

    const [category] = await this.db
      .insert(schema.categories)
      .values({
        name: dto.name,
        slug,
        description: dto.description,
      })
      .returning();

    // Invalidate the cache
    await this.redisService.del('categories:all');

    return category;
  }

  async findAll(): Promise<schema.Category[]> {
    const cached = await this.redisService.get('categories:all');
    if (cached) {
      return JSON.parse(cached);
    }

    const categories = await this.db.select().from(schema.categories);
    
    // Cache for 1 hour (3600 seconds)
    await this.redisService.set('categories:all', JSON.stringify(categories), 3600);
    
    return categories;
  }

  async findOne(id: string): Promise<schema.Category> {
    const [category] = await this.db
      .select()
      .from(schema.categories)
      .where(eq(schema.categories.id, id));

    if (!category) {
      throw new EntityNotFoundError(`Category with ID "${id}" not found`);
    }

    return category;
  }

  async update(
    id: string,
    dto: Partial<CreateCategoryDto>,
  ): Promise<schema.Category> {
    await this.findOne(id); // throws 404 if not found

    const updateData: Partial<schema.NewCategory> = {};
    if (dto.name) {
      updateData.name = dto.name;
      updateData.slug = dto.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)+/g, '');
    }
    if (dto.description !== undefined) updateData.description = dto.description;

    const [updated] = await this.db
      .update(schema.categories)
      .set({ ...updateData, updatedAt: new Date() })
      .where(eq(schema.categories.id, id))
      .returning();

    // Invalidate the cache
    await this.redisService.del('categories:all');

    return updated;
  }

  async remove(id: string): Promise<schema.Category> {
    await this.findOne(id); // throws 404 if not found

    const [deleted] = await this.db
      .delete(schema.categories)
      .where(eq(schema.categories.id, id))
      .returning();

    // Invalidate the cache
    await this.redisService.del('categories:all');

    return deleted;
  }
}
