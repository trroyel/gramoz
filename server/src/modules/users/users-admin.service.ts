import {
  Inject,
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE } from '@database/database.module';
import * as schema from '@database/schema';
import { eq, or, ilike, desc, asc, count, sum, sql, and } from 'drizzle-orm';
import { GetUsersQueryDto } from './dto/users-admin.dto';

@Injectable()
export class UsersAdminService {
  constructor(
    @Inject(DATABASE)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async getUsers(query: GetUsersQueryDto) {
    const {
      page = 1,
      limit = 10,
      query: search,
      role,
      status,
      sortBy,
      sortOrder,
    } = query;
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
      conditions.push(eq(schema.users.status, status));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Use SQL aggregation to get total orders and total spending without N+1
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
        totalSpending:
          sql<number>`COALESCE(SUM(${schema.orders.totalAmount}), 0)`.as(
            'total_spending',
          ),
      })
      .from(schema.users)
      .leftJoin(schema.orders, eq(schema.users.id, schema.orders.userId))
      .where(whereClause)
      .groupBy(schema.users.id);

    // Apply sorting
    let orderClause;
    if (sortBy === 'totalOrders') {
      orderClause =
        sortOrder === 'asc'
          ? asc(sql`count(${schema.orders.id})`)
          : desc(sql`count(${schema.orders.id})`);
    } else if (sortBy === 'totalSpending') {
      orderClause =
        sortOrder === 'asc'
          ? asc(sql`sum(${schema.orders.totalAmount})`)
          : desc(sql`sum(${schema.orders.totalAmount})`);
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
      const sortColumn = allowedSortColumns[sortBy] || schema.users.createdAt;
      orderClause = sortOrder === 'asc' ? asc(sortColumn) : desc(sortColumn);
    }

    const data = await baseQuery
      .orderBy(orderClause)
      .limit(limit)
      .offset(offset);

    // Count query for pagination
    const countQuery = await this.db
      .select({ count: count() })
      .from(schema.users)
      .where(whereClause);

    const total = Number(countQuery[0].count);

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

  async getUserDetails(id: string) {
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
        totalSpending:
          sql<number>`COALESCE(SUM(${schema.orders.totalAmount}), 0)`.as(
            'total_spending',
          ),
      })
      .from(schema.users)
      .leftJoin(schema.orders, eq(schema.users.id, schema.orders.userId))
      .where(eq(schema.users.id, id))
      .groupBy(schema.users.id);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async updateRole(adminId: string, targetUserId: string, newRole: string) {
    if (adminId === targetUserId) {
      throw new BadRequestException(
        'You cannot modify your own role. This prevents accidental lockouts.',
      );
    }

    const [user] = await this.db
      .update(schema.users)
      .set({ role: newRole as any, updatedAt: new Date() })
      .where(eq(schema.users.id, targetUserId))
      .returning();

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async updateStatus(targetUserId: string, newStatus: string) {
    const [user] = await this.db
      .update(schema.users)
      .set({ status: newStatus, updatedAt: new Date() })
      .where(eq(schema.users.id, targetUserId))
      .returning();

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async getUserOrders(userId: string) {
    // Check if user exists
    const [user] = await this.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.id, userId));
    if (!user) throw new NotFoundException('User not found');

    return this.db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.userId, userId))
      .orderBy(desc(schema.orders.createdAt));
  }
}
