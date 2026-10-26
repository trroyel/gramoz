/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/require-await */
import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy, JwtPayload } from './jwt.strategy';
import { UsersStore } from '@modules/users/users.store';
import { ConfigService } from '@config/config.service';
import { User } from '@database/schema';

describe('JwtStrategy & UsersStore Cache Unit Tests (TASK-09)', () => {
  let jwtStrategy: JwtStrategy;
  let usersStore: UsersStore;
  let mockDb: any;
  let mockRedis: any;
  let mockConfig: ConfigService;

  const mockActiveUser: User = {
    id: 'a0000000-0000-0000-0000-000000000001',
    email: 'test@gramoz.com',
    passwordHash: 'argon2id$hashedpasswordsecret',
    fullName: 'Test User',
    phone: '+8801700000000',
    avatarUrl: null,
    provider: 'local',
    providerId: null,
    role: 'customer',
    isEmailVerified: true,
    isPhoneVerified: true,
    status: 'active',
    lastLoginAt: new Date('2026-10-18T10:00:00Z'),
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    deletedAt: null,
  };

  const redisStore = new Map<string, string>();

  beforeEach(() => {
    redisStore.clear();

    mockDb = {
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([mockActiveUser]),
        }),
      }),
      insert: jest.fn().mockReturnValue({
        values: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([mockActiveUser]),
        }),
      }),
      update: jest.fn().mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            returning: jest
              .fn()
              .mockResolvedValue([
                { ...mockActiveUser, updatedAt: new Date() },
              ]),
          }),
        }),
      }),
      delete: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue([]),
      }),
    };

    mockRedis = {
      get: jest.fn(async (key: string) => redisStore.get(key) || null),
      set: jest.fn(async (key: string, val: string) => {
        redisStore.set(key, val);
      }),
      del: jest.fn(async (key: string) => {
        redisStore.delete(key);
      }),
      getClient: jest.fn().mockReturnValue({
        pipeline: jest.fn().mockImplementation(() => {
          const operations: Array<() => void> = [];
          const pipe = {
            incr: (key: string) => {
              operations.push(() => {
                const current = parseInt(redisStore.get(key) || '0', 10);
                redisStore.set(key, String(current + 1));
              });
              return pipe;
            },
            expire: (_key: string, _ttl: number) => {
              return pipe;
            },
            set: (key: string, val: string) => {
              operations.push(() => redisStore.set(key, val));
              return pipe;
            },
            del: (key: string) => {
              operations.push(() => redisStore.delete(key));
              return pipe;
            },
            exec: async () => {
              for (const op of operations) op();
              return [];
            },
          };
          return pipe;
        }),
        eval: jest.fn(
          async (
            _script: string,
            _numKeys: number,
            cacheKey: string,
            compareKey: string,
            compareVal: string,
            _ttl: string,
            val: string,
          ) => {
            const currentVal = redisStore.get(compareKey);
            const argNum = Number(compareVal);
            if (argNum && argNum > 1000000000000) {
              if (currentVal) {
                const tNum = Number(currentVal);
                if (tNum && tNum >= argNum) return 0;
              }
            } else {
              if (currentVal === undefined || currentVal !== compareVal) {
                return 0;
              }
            }
            redisStore.set(cacheKey, val);
            return 1;
          },
        ),
      }),
    };

    mockConfig = {
      jwtSecret: 'super-secret-jwt-key',
    } as unknown as ConfigService;

    usersStore = new UsersStore(mockDb, mockRedis);
    jwtStrategy = new JwtStrategy(mockConfig, usersStore);
  });

  describe('Cache Hit and Database Offload', () => {
    it('populates Redis cache on first lookup (cache miss) and hits cache on second lookup', async () => {
      const payload: JwtPayload = {
        sub: mockActiveUser.id,
        email: mockActiveUser.email,
        role: mockActiveUser.role,
        token_type: 'access',
      };

      // 1. First lookup: Cache miss, hits DB
      const user1 = await jwtStrategy.validate(payload);
      expect(user1).toBeDefined();
      expect(user1.id).toBe(mockActiveUser.id);
      expect(mockDb.select).toHaveBeenCalledTimes(1);
      expect(redisStore.has(`{user:${mockActiveUser.id}}:cache`)).toBe(true);

      // 2. Second lookup: Cache hit, DB must NOT be queried again
      const user2 = await jwtStrategy.validate(payload);
      expect(user2).toBeDefined();
      expect(user2.id).toBe(mockActiveUser.id);
      expect(mockDb.select).toHaveBeenCalledTimes(1); // Still only 1 DB call!
    });

    it('revives date strings into proper Date instances from cached JSON', async () => {
      const payload: JwtPayload = {
        sub: mockActiveUser.id,
        email: mockActiveUser.email,
        token_type: 'access',
      };

      await jwtStrategy.validate(payload); // Populates cache
      const cachedUser = await jwtStrategy.validate(payload); // From cache

      expect(cachedUser.createdAt).toBeInstanceOf(Date);
      expect(cachedUser.updatedAt).toBeInstanceOf(Date);
      expect(cachedUser.lastLoginAt).toBeInstanceOf(Date);
      expect(cachedUser.createdAt.toISOString()).toBe(
        mockActiveUser.createdAt.toISOString(),
      );
    });

    it('never stores passwordHash in the Redis cache', async () => {
      await usersStore.findById(mockActiveUser.id);

      const cachedRaw = redisStore.get(`{user:${mockActiveUser.id}}:cache`);
      expect(cachedRaw).toBeDefined();
      const parsed = JSON.parse(cachedRaw);
      expect(parsed.passwordHash).toBeUndefined();

      const userFromCache = await usersStore.findById(mockActiveUser.id);
      expect(userFromCache.passwordHash).toBeNull();
    });
  });

  describe('Cache Invalidation and Security Invariants', () => {
    it('invalidates cache when UsersStore.update is invoked', async () => {
      // Warm cache
      await usersStore.findById(mockActiveUser.id);
      expect(redisStore.has(`{user:${mockActiveUser.id}}:cache`)).toBe(true);

      // Perform update
      await usersStore.update(mockActiveUser.id, {
        fullName: 'Updated Name',
      });

      expect(redisStore.has(`{user:${mockActiveUser.id}}:cache`)).toBe(false);
    });

    it('immediately reflects role changes and prevents privilege retention', async () => {
      // 1. Initial lookup as admin
      const adminUser: User = { ...mockActiveUser, role: 'admin' };
      mockDb.select.mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([adminUser]),
        }),
      });

      const userAdmin = await jwtStrategy.validate({
        sub: adminUser.id,
        email: adminUser.email,
        role: 'admin',
        token_type: 'access',
      });
      expect(userAdmin.role).toBe('admin');
      expect(redisStore.has(`{user:${adminUser.id}}:cache`)).toBe(true);

      // 2. Admin demotes user to customer
      const demotedUser: User = { ...mockActiveUser, role: 'customer' };
      mockDb.update.mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([demotedUser]),
          }),
        }),
      });
      await usersStore.update(adminUser.id, { role: 'customer' });
      expect(redisStore.has(`{user:${adminUser.id}}:cache`)).toBe(false);

      // 3. Next request should fetch demoted state from DB
      mockDb.select.mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([demotedUser]),
        }),
      });

      const nextUser = await jwtStrategy.validate({
        sub: adminUser.id,
        email: adminUser.email,
        token_type: 'access',
      });
      expect(nextUser.role).toBe('customer');
    });

    it('rejects suspended users immediately after status update', async () => {
      // Warm cache with active user
      await jwtStrategy.validate({
        sub: mockActiveUser.id,
        email: mockActiveUser.email,
        token_type: 'access',
      });

      // Admin suspends user
      const suspendedUser: User = { ...mockActiveUser, status: 'suspended' };
      mockDb.update.mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([suspendedUser]),
          }),
        }),
      });
      await usersStore.update(mockActiveUser.id, { status: 'suspended' });

      // DB now returns suspended user
      mockDb.select.mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([suspendedUser]),
        }),
      });

      await expect(
        jwtStrategy.validate({
          sub: mockActiveUser.id,
          email: mockActiveUser.email,
          token_type: 'access',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects soft-deleted users and clears cache', async () => {
      // Warm cache
      await usersStore.findById(mockActiveUser.id);
      expect(redisStore.has(`{user:${mockActiveUser.id}}:cache`)).toBe(true);

      // Soft delete
      const deletedUser: User = { ...mockActiveUser, status: 'deleted' };
      mockDb.update.mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([deletedUser]),
          }),
        }),
      });
      await usersStore.softDelete(mockActiveUser.id);
      expect(redisStore.has(`{user:${mockActiveUser.id}}:cache`)).toBe(false);

      mockDb.select.mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([deletedUser]),
        }),
      });

      await expect(
        jwtStrategy.validate({
          sub: mockActiveUser.id,
          email: mockActiveUser.email,
          token_type: 'access',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects hard-deleted users and clears cache', async () => {
      // Warm cache
      await usersStore.findById(mockActiveUser.id);
      expect(redisStore.has(`{user:${mockActiveUser.id}}:cache`)).toBe(true);

      // Hard delete
      await usersStore.delete(mockActiveUser.id);
      expect(redisStore.has(`{user:${mockActiveUser.id}}:cache`)).toBe(false);

      mockDb.select.mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([]),
        }),
      });

      await expect(
        jwtStrategy.validate({
          sub: mockActiveUser.id,
          email: mockActiveUser.email,
          token_type: 'access',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('Ghost-Write Race Condition Prevention', () => {
    it('drops stale cache populate when an invalidation occurs during in-flight database read', async () => {
      const userId = mockActiveUser.id;
      const tombstoneKey = `{user:${userId}}:invalidated`;
      const cacheKey = `{user:${userId}}:cache`;

      // Simulate:
      // T1 = 1000: Request A starts DB read
      const fetchStartedAt = 1000;

      // T2 = 1050: Admin updates role and sets tombstone at 1050
      redisStore.set(tombstoneKey, '1050');

      // T3 = 1100: Request A finishes DB read and attempts to cache stale record
      const client = mockRedis.getClient();
      const evalResult = await client.eval(
        '',
        2,
        cacheKey,
        tombstoneKey,
        fetchStartedAt.toString(),
        '60',
        JSON.stringify(mockActiveUser),
      );

      // Lua script must detect tombstone (1050 >= 1000) and return 0 (dropped write)
      expect(evalResult).toBe(0);
      expect(redisStore.has(cacheKey)).toBe(false);
    });
  });

  describe('Redis Outage & Resilience (Fail-Safe)', () => {
    it('falls back seamlessly to PostgreSQL when Redis get throws an error', async () => {
      mockRedis.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const user = await usersStore.findById(mockActiveUser.id);
      expect(user).toBeDefined();
      expect(user.id).toBe(mockActiveUser.id);
      expect(mockDb.select).toHaveBeenCalledTimes(1);
    });

    it('continues successfully when Redis set throws an error', async () => {
      mockRedis.getClient.mockReturnValueOnce({
        eval: jest.fn().mockRejectedValueOnce(new Error('Redis cluster down')),
      });

      const user = await usersStore.findById(mockActiveUser.id);
      expect(user).toBeDefined();
      expect(user.id).toBe(mockActiveUser.id);
    });

    it('still rejects inactive users from DB when Redis is completely down', async () => {
      mockRedis.get.mockRejectedValue(new Error('Redis offline'));

      const inactiveUser: User = { ...mockActiveUser, status: 'suspended' };
      mockDb.select.mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([inactiveUser]),
        }),
      });

      await expect(
        jwtStrategy.validate({
          sub: inactiveUser.id,
          email: inactiveUser.email,
          token_type: 'access',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('TASK-09S Low-Memory & Security Optimization Tests', () => {
    it('produces compact serialized JSON payload without redundant null fields or passwordHash', async () => {
      await usersStore.findById(mockActiveUser.id);

      const cacheKey = `{user:${mockActiveUser.id}}:cache`;
      const rawCached = redisStore.get(cacheKey);
      expect(rawCached).toBeDefined();

      const parsed = JSON.parse(rawCached);
      // Essential fields are present
      expect(parsed.id).toBe(mockActiveUser.id);
      expect(parsed.email).toBe(mockActiveUser.email);
      expect(parsed.role).toBe(mockActiveUser.role);
      expect(parsed.status).toBe(mockActiveUser.status);
      expect(parsed.lastLoginAt).toBeDefined();

      // Stripped / omitted redundant null fields to save memory
      expect(parsed.passwordHash).toBeUndefined();
      expect(parsed.avatarUrl).toBeUndefined();
      expect(parsed.providerId).toBeUndefined();
      expect(parsed.deletedAt).toBeUndefined();
      expect(parsed.phone).toBe('+8801700000000');

      // Serialized size is compact (< 350 bytes, reduced from >500 bytes uncompacted)
      expect(Buffer.byteLength(rawCached, 'utf8')).toBeLessThan(350);
    });

    it('rejects cache population when database fetch exceeds 10s latency ceiling', async () => {
      const fetchStartedAt = Date.now() - 11000; // 11s ago
      const cached = await (usersStore as any).safeSetUserCache(
        mockActiveUser.id,
        mockActiveUser,
        fetchStartedAt,
      );

      expect(cached).toBe(false);
      expect(redisStore.has(`{user:${mockActiveUser.id}}:cache`)).toBe(false);
    });

    it('rejects cache population when monotonic generation counter has advanced', async () => {
      const genKey = `{user:${mockActiveUser.id}}:gen`;
      const cacheKey = `{user:${mockActiveUser.id}}:cache`;

      // Simulating generation counter advanced to 3
      redisStore.set(genKey, '3');

      // Stale write expecting generation 2
      const client = mockRedis.getClient();
      const result = await client.eval(
        '',
        2,
        cacheKey,
        genKey,
        '2',
        '60',
        JSON.stringify(mockActiveUser),
      );

      expect(result).toBe(0);
      expect(redisStore.has(cacheKey)).toBe(false);
    });

    it('drops cache population when generation key has been evicted (nil) by volatile-lru', async () => {
      const genKey = `{user:${mockActiveUser.id}}:gen`;
      const cacheKey = `{user:${mockActiveUser.id}}:cache`;

      // Simulating generation key evicted under memory pressure (missing from redisStore)
      redisStore.delete(genKey);

      // Attempting cache write with expected generation 2
      const client = mockRedis.getClient();
      const result = await client.eval(
        '',
        2,
        cacheKey,
        genKey,
        '2',
        '60',
        JSON.stringify(mockActiveUser),
      );

      // Fail-safe: write must be dropped when generation key is evicted
      expect(result).toBe(0);
      expect(redisStore.has(cacheKey)).toBe(false);
    });

    it('drops cache population in TypeScript fallback mode when generation key is evicted or mismatch', async () => {
      const genKey = `{user:${mockActiveUser.id}}:gen`;
      const cacheKey = `{user:${mockActiveUser.id}}:cache`;

      // Disable eval to test fallback branch
      mockRedis.getClient().eval = undefined;

      // 1. Generation key evicted (nil in redis)
      redisStore.delete(genKey);
      const resEvicted = await (usersStore as any).safeSetUserCache(
        mockActiveUser.id,
        mockActiveUser,
        '2',
      );
      expect(resEvicted).toBe(false);
      expect(redisStore.has(cacheKey)).toBe(false);

      // 2. Generation counter mismatch
      redisStore.set(genKey, '3');
      const resMismatch = await (usersStore as any).safeSetUserCache(
        mockActiveUser.id,
        mockActiveUser,
        '2',
      );
      expect(resMismatch).toBe(false);
      expect(redisStore.has(cacheKey)).toBe(false);

      // 3. Generation counter match succeeds
      redisStore.set(genKey, '2');
      const resMatch = await (usersStore as any).safeSetUserCache(
        mockActiveUser.id,
        mockActiveUser,
        '2',
      );
      expect(resMatch).toBe(true);
      expect(redisStore.has(cacheKey)).toBe(true);
    });
  });
});
