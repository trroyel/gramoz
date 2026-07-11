import { Inject, Injectable } from '@nestjs/common';
import { eq, and, or, ilike, desc, asc, count, sum, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE } from '@database/database.module';
import * as schema from '@database/schema';
import { NewUser, User } from '@database/schema';

@Injectable()
export class UsersStore {
  constructor(
    @Inject(DATABASE)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async findAll(): Promise<User[]> {
    return this.db.select().from(schema.users);
  }

  async findById(id: string): Promise<User | undefined> {
    const [user] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, id));
    return user;
  }

  async findByEmail(email: string): Promise<User | undefined> {
    const [user] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email));
    return user;
  }

  async findByProviderId(
    provider: string,
    providerId: string,
  ): Promise<User | undefined> {
    const [user] = await this.db
      .select()
      .from(schema.users)
      .where(
        and(
          eq(schema.users.provider, provider),
          eq(schema.users.providerId, providerId),
        ),
      );
    return user;
  }

  async create(data: NewUser): Promise<User> {
    const [user] = await this.db.insert(schema.users).values(data).returning();
    return user;
  }

  async update(id: string, data: Partial<NewUser>): Promise<User | undefined> {
    const [user] = await this.db
      .update(schema.users)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.users.id, id))
      .returning();
    return user;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(schema.users).where(eq(schema.users.id, id));
  }

  async softDelete(id: string): Promise<User | undefined> {
    const [user] = await this.db
      .update(schema.users)
      .set({ deletedAt: new Date(), status: 'deleted' })
      .where(eq(schema.users.id, id))
      .returning();
    return user;
  }

  async getUsersWithStats(
    page: number,
    limit: number,
    search?: string,
    role?: string,
    status?: string,
    sortBy?: string,
    sortOrder?: 'asc' | 'desc',
  ) {
    const offset = (page - 1) * limit;

    const conditions = [];
    if (search) {
      conditions.push(
        or(
          ilike(schema.users.fullName, `%${search}%`),
          ilike(schema.users.email, `%${search}%`),
          ilike(schema.users.phone, `%${search}%`),
        ),
      );
    }
    if (role) {
      conditions.push(eq(schema.users.role, role as any));
    }
    if (status) {
      conditions.push(eq(schema.users.status, status as any));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const baseQuery = this.db
      .select({
        id: schema.users.id,
        email: schema.users.email,
        fullName: schema.users.fullName,
        phone: schema.users.phone,
        role: schema.users.role,
        status: schema.users.status,
        createdAt: schema.users.createdAt,
        lastLoginAt: schema.users.lastLoginAt,
        totalOrders: count(schema.orders.id).as('total_orders'),
        totalSpending: sql<number>`COALESCE(SUM(${schema.orders.totalAmount}), 0)`.as('total_spending'),
      })
      .from(schema.users)
      .leftJoin(schema.orders, eq(schema.users.id, schema.orders.userId))
      .where(whereClause)
      .groupBy(schema.users.id);

    let orderClause;
    if (sortBy === 'totalOrders') {
      orderClause = sortOrder === 'asc' ? asc(sql`count(${schema.orders.id})`) : desc(sql`count(${schema.orders.id})`);
    } else if (sortBy === 'totalSpending') {
      orderClause = sortOrder === 'asc' ? asc(sql`sum(${schema.orders.totalAmount})`) : desc(sql`sum(${schema.orders.totalAmount})`);
    } else {
      const allowedSortColumns: Record<string, any> = {
        email: schema.users.email,
        fullName: schema.users.fullName,
        phone: schema.users.phone,
        role: schema.users.role,
        status: schema.users.status,
        createdAt: schema.users.createdAt,
        lastLoginAt: schema.users.lastLoginAt,
      };
      const sortColumn = allowedSortColumns[sortBy!] || schema.users.createdAt;
      orderClause = sortOrder === 'asc' ? asc(sortColumn) : desc(sortColumn);
    }

    const data = await baseQuery.orderBy(orderClause).limit(limit).offset(offset);

    const countQuery = await this.db
      .select({ count: count() })
      .from(schema.users)
      .where(whereClause);

    const total = Number(countQuery[0].count);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getUserDetailsWithStats(id: string) {
    const [user] = await this.db
      .select({
        id: schema.users.id,
        email: schema.users.email,
        fullName: schema.users.fullName,
        phone: schema.users.phone,
        role: schema.users.role,
        status: schema.users.status,
        isEmailVerified: schema.users.isEmailVerified,
        isPhoneVerified: schema.users.isPhoneVerified,
        createdAt: schema.users.createdAt,
        lastLoginAt: schema.users.lastLoginAt,
        totalOrders: count(schema.orders.id).as('total_orders'),
        totalSpending: sql<number>`COALESCE(SUM(${schema.orders.totalAmount}), 0)`.as('total_spending'),
      })
      .from(schema.users)
      .leftJoin(schema.orders, eq(schema.users.id, schema.orders.userId))
      .where(eq(schema.users.id, id))
      .groupBy(schema.users.id);

    return user;
  }

  async getUserOrders(userId: string) {
    return this.db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.userId, userId))
      .orderBy(desc(schema.orders.createdAt));
  }
}
