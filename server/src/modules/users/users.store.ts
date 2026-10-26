import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { eq, and, or, ilike, desc, asc, count, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DATABASE } from '@database/database.module';
import * as schema from '@database/schema';
import { NewUser, User } from '@database/schema';
import { RedisService } from '@cache/redis.service';

@Injectable()
export class UsersStore {
  private readonly logger = new Logger(UsersStore.name);
  public static readonly CACHE_TTL_SECONDS = 60;
  public static readonly GEN_TTL_SECONDS = 86400; // 24 hours
  public static readonly TOMBSTONE_TTL_SECONDS = 86400; // 24 hours (extended to eliminate SEC-09-A)

  private static readonly SAFE_SET_LUA = `
    local currentVal = redis.call('get', KEYS[2])
    local argNum = tonumber(ARGV[1])
    if argNum and argNum > 1000000000000 then
      if currentVal then
        local tNum = tonumber(currentVal)
        if tNum and tNum >= argNum then
          return 0
        end
      end
    else
      if currentVal == nil or currentVal ~= ARGV[1] then
        return 0
      end
    end
    redis.call('setex', KEYS[1], tonumber(ARGV[2]), ARGV[3])
    return 1
  `;

  constructor(
    @Inject(DATABASE)
    private readonly db: NodePgDatabase<typeof schema>,
    @Optional()
    private readonly redis?: RedisService,
  ) {}

  private getCacheKey(id: string): string {
    return `{user:${id}}:cache`;
  }

  private getTombstoneKey(id: string): string {
    return `{user:${id}}:invalidated`;
  }

  private getGenKey(id: string): string {
    return `{user:${id}}:gen`;
  }

  private formatErrorMessage(err: unknown): string {
    return err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : 'Unknown error';
  }

  private serializeUser(user: User): string {
    return JSON.stringify({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      status: user.status,
      phone: user.phone || null,
      isEmailVerified: user.isEmailVerified,
      isPhoneVerified: user.isPhoneVerified,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    });
  }

  private reviveUser(cached: Partial<User>): User {
    return {
      ...(cached as User),
      passwordHash: null,
      fullName: cached.fullName || '',
      role: cached.role || 'customer',
      status: cached.status || 'active',
      phone: cached.phone || null,
      avatarUrl: cached.avatarUrl || null,
      provider: cached.provider || 'local',
      providerId: cached.providerId || null,
      isEmailVerified: Boolean(cached.isEmailVerified),
      isPhoneVerified: Boolean(cached.isPhoneVerified),
      lastLoginAt: cached.lastLoginAt ? new Date(cached.lastLoginAt) : null,
      createdAt: cached.createdAt ? new Date(cached.createdAt) : new Date(),
      updatedAt: cached.updatedAt ? new Date(cached.updatedAt) : new Date(),
      deletedAt: cached.deletedAt ? new Date(cached.deletedAt) : null,
    };
  }

  async getCachedUser(id: string): Promise<User | null> {
    if (!this.redis) return null;
    try {
      const cached = await this.redis.get(this.getCacheKey(id));
      if (!cached) return null;
      return this.reviveUser(JSON.parse(cached) as Partial<User>);
    } catch (err: unknown) {
      this.logger.warn(
        `Failed to read user cache for ${id}: ${this.formatErrorMessage(err)}`,
      );
      return null;
    }
  }

  async getUserGeneration(id: string): Promise<string> {
    if (!this.redis) return '0';
    try {
      const gen = await this.redis.get(this.getGenKey(id));
      return gen || '0';
    } catch (err: unknown) {
      this.logger.warn(
        `Failed to read user generation for ${id}: ${this.formatErrorMessage(err)}`,
      );
      return '0';
    }
  }

  private async safeSetUserCache(
    id: string,
    user: User,
    fetchStartedAtOrGen: number | string,
  ): Promise<boolean> {
    if (!this.redis) return false;

    // Defense-in-depth: if DB query latency exceeded 10s, do not populate cache
    if (typeof fetchStartedAtOrGen === 'number') {
      const elapsed = Date.now() - fetchStartedAtOrGen;
      if (elapsed > 10_000) {
        this.logger.warn(
          `Dropping cache populate for ${id}: DB query took ${elapsed}ms (> 10s ceiling)`,
        );
        return false;
      }
    }

    const serialized = this.serializeUser(user);
    const cacheKey = this.getCacheKey(id);
    const tombstoneKey = this.getTombstoneKey(id);
    const genKey = this.getGenKey(id);

    try {
      const client = this.redis.getClient() as unknown as {
        eval?: (
          script: string,
          numKeys: number,
          key1: string,
          key2: string,
          arg1: string,
          arg2: string,
          arg3: string,
        ) => Promise<number>;
      };
      const compareKey =
        typeof fetchStartedAtOrGen === 'string' && fetchStartedAtOrGen !== '0'
          ? genKey
          : tombstoneKey;
      const compareVal = fetchStartedAtOrGen.toString();

      if (typeof client?.eval === 'function') {
        const res = await client.eval(
          UsersStore.SAFE_SET_LUA,
          2,
          cacheKey,
          compareKey,
          compareVal,
          UsersStore.CACHE_TTL_SECONDS.toString(),
          serialized,
        );
        return res === 1;
      } else {
        const currentVal = await this.redis.get(compareKey);
        const argNum = parseInt(compareVal, 10);
        if (argNum && argNum > 1000000000000) {
          if (currentVal) {
            const tNum = parseInt(currentVal, 10);
            if (tNum && tNum >= argNum) return false;
          }
        } else {
          if (currentVal === null || currentVal !== compareVal) {
            return false;
          }
        }
        await this.redis.set(
          cacheKey,
          serialized,
          UsersStore.CACHE_TTL_SECONDS,
        );
        return true;
      }
    } catch (err: unknown) {
      this.logger.warn(
        `Failed to set user cache for ${id}: ${this.formatErrorMessage(err)}`,
      );
      return false;
    }
  }

  async invalidateUserCache(id: string): Promise<void> {
    if (!this.redis) return;

    const cacheKey = this.getCacheKey(id);
    const genKey = this.getGenKey(id);
    const tombstoneKey = this.getTombstoneKey(id);
    const now = Date.now();

    try {
      const client = this.redis.getClient();
      if (typeof client?.pipeline === 'function') {
        const pipe = client.pipeline();
        if (typeof pipe.incr === 'function') {
          pipe.incr(genKey);
        }
        if (typeof pipe.expire === 'function') {
          pipe.expire(genKey, UsersStore.GEN_TTL_SECONDS);
        }
        pipe.set(
          tombstoneKey,
          String(now),
          'EX',
          UsersStore.TOMBSTONE_TTL_SECONDS,
        );
        pipe.del(cacheKey);
        await pipe.exec();
      } else {
        if (typeof client?.incr === 'function') {
          await client.incr(genKey);
          if (typeof client?.expire === 'function') {
            await client.expire(genKey, UsersStore.GEN_TTL_SECONDS);
          }
        }
        await this.redis.set(
          tombstoneKey,
          String(now),
          UsersStore.TOMBSTONE_TTL_SECONDS,
        );
        await this.redis.del(cacheKey);
      }
    } catch (err: unknown) {
      this.logger.error(
        `Failed to invalidate cache for user ${id}: ${this.formatErrorMessage(err)}`,
      );
    }
  }

  async findAll(): Promise<User[]> {
    return this.db.select().from(schema.users);
  }

  async findById(
    id: string,
    options?: { skipCache?: boolean },
  ): Promise<User | undefined> {
    const skipCache = options?.skipCache ?? false;

    if (!skipCache && this.redis) {
      try {
        const cached = await this.redis.get(this.getCacheKey(id));
        if (cached) {
          return this.reviveUser(JSON.parse(cached) as Partial<User>);
        }
      } catch (err: unknown) {
        this.logger.warn(
          `Redis lookup failed for user ${id}, falling back to database: ${this.formatErrorMessage(err)}`,
        );
      }
    }

    const fetchStartedAt = Date.now();
    const expectedGen =
      !skipCache && this.redis ? await this.getUserGeneration(id) : '0';

    const [user] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, id));

    if (!user) {
      return undefined;
    }

    if (!skipCache && this.redis) {
      try {
        await this.safeSetUserCache(
          id,
          user,
          expectedGen !== '0' ? expectedGen : fetchStartedAt,
        );
      } catch (err: unknown) {
        this.logger.warn(
          `Failed to populate user cache for ${id}: ${this.formatErrorMessage(err)}`,
        );
      }
    }

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
    if (user) {
      await this.invalidateUserCache(user.id);
    }
    return user;
  }

  async update(id: string, data: Partial<NewUser>): Promise<User | undefined> {
    const [user] = await this.db
      .update(schema.users)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.users.id, id))
      .returning();

    if (user) {
      await this.invalidateUserCache(id);
    }
    return user;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(schema.users).where(eq(schema.users.id, id));
    await this.invalidateUserCache(id);
  }

  async softDelete(id: string): Promise<User | undefined> {
    const [user] = await this.db
      .update(schema.users)
      .set({ deletedAt: new Date(), status: 'deleted' })
      .where(eq(schema.users.id, id))
      .returning();

    if (user) {
      await this.invalidateUserCache(id);
    }
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
        totalSpending:
          sql<number>`COALESCE(SUM(${schema.orders.totalAmount}), 0)`.as(
            'total_spending',
          ),
      })
      .from(schema.users)
      .leftJoin(schema.orders, eq(schema.users.id, schema.orders.userId))
      .where(whereClause)
      .groupBy(schema.users.id);

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
        totalSpending:
          sql<number>`COALESCE(SUM(${schema.orders.totalAmount}), 0)`.as(
            'total_spending',
          ),
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
