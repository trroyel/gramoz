import { Injectable, Inject, NotFoundException, ConflictException } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { DATABASE } from '@database/database.module';
import * as schema from '@database/schema';
import { CreateCategoryDto } from './dto/create-category.dto';

@Injectable()
export class CategoriesService {
  constructor(
    @Inject(DATABASE) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async create(dto: CreateCategoryDto) {
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
      throw new ConflictException(`Category with name "${dto.name}" already exists`);
    }

    const [category] = await this.db
      .insert(schema.categories)
      .values({
        name: dto.name,
        slug,
        description: dto.description,
      })
      .returning();

    return category;
  }

  async findAll() {
    return this.db.select().from(schema.categories);
  }

  async findOne(id: string) {
    const [category] = await this.db
      .select()
      .from(schema.categories)
      .where(eq(schema.categories.id, id));

    if (!category) {
      throw new NotFoundException(`Category with ID "${id}" not found`);
    }

    return category;
  }

  async update(id: string, dto: Partial<CreateCategoryDto>) {
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

    return updated;
  }

  async remove(id: string) {
    await this.findOne(id); // throws 404 if not found

    const [deleted] = await this.db
      .delete(schema.categories)
      .where(eq(schema.categories.id, id))
      .returning();

    return deleted;
  }
}
