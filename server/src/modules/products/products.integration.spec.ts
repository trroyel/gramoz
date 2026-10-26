/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { Test, TestingModule } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import Redis from 'ioredis';
import * as schema from '@database/schema';
import { Role } from '@database/schema';
import { DATABASE } from '@database/database.module';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { StorageService } from '../storage/storage.service';
import { RedisService } from '../../cache/redis.service';
import { ConfigService } from '@config/config.service';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { UsersStore } from '../users/users.store';

describe('Products & Catalog API Security & Integration (TASK-20)', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let db: ReturnType<typeof drizzle>;
  let redisClient: Redis;
  let redisService: RedisService;
  let jwtService: JwtService;

  const testDbUrl =
    process.env.DATABASE_URL ||
    'postgresql://platform_user:platform_pass@localhost:5433/platform_db';
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const redisPort = Number(process.env.REDIS_PORT) || 6380;
  const redisPass = process.env.REDIS_PASSWORD || 'redis_pass';
  const jwtSecret = 'test-products-secret-at-least-32-chars-long';

  const createdProductIds: string[] = [];
  const createdUserIds: string[] = [];

  let adminToken: string;
  let managerToken: string;
  let customerToken: string;

  let seededProductId: string;

  beforeAll(async () => {
    // 1. Connect real PostgreSQL 16
    pool = new Pool({
      connectionString: testDbUrl,
      connectionTimeoutMillis: 5000,
      max: 10,
    });
    db = drizzle(pool, { schema });

    // 2. Connect real Redis 7
    redisClient = new Redis({
      host: redisHost,
      port: redisPort,
      password: redisPass,
      maxRetriesPerRequest: 3,
    });

    const mockConfig: Partial<ConfigService> = {
      jwtSecret,
      jwtExpiresIn: '1h',
      redisHost,
      redisPort,
      redisPassword: redisPass,
    };

    redisService = new RedisService(mockConfig as ConfigService);
    const usersStore = new UsersStore(db as any, redisService);

    const mockStorageService = {
      upload: jest
        .fn()
        .mockResolvedValue('https://cdn.gramoz.com/mock-upload.png'),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.register({
          secret: jwtSecret,
          signOptions: { expiresIn: '1h' },
        }),
      ],
      controllers: [ProductsController],
      providers: [
        ProductsService,
        JwtStrategy,
        { provide: DATABASE, useValue: db },
        { provide: RedisService, useValue: redisService },
        { provide: StorageService, useValue: mockStorageService },
        { provide: UsersStore, useValue: usersStore },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    jwtService = moduleFixture.get<JwtService>(JwtService);

    const fastifyAdapter = new FastifyAdapter();
    app =
      moduleFixture.createNestApplication<NestFastifyApplication>(
        fastifyAdapter,
      );

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    );

    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    // 3. Create test users in DB
    const [adminUser] = await db
      .insert(schema.users)
      .values({
        email: `admin-prod-${Date.now()}@gramoz.com`,
        passwordHash: 'dummy-hash',
        fullName: 'Admin User',
        role: Role.ADMIN,
        status: 'active',
      })
      .returning();
    createdUserIds.push(adminUser.id);
    adminToken = jwtService.sign({
      sub: adminUser.id,
      role: Role.ADMIN,
      email: adminUser.email,
      token_type: 'access',
    });

    const [mgrUser] = await db
      .insert(schema.users)
      .values({
        email: `mgr-prod-${Date.now()}@gramoz.com`,
        passwordHash: 'dummy-hash',
        fullName: 'Manager User',
        role: Role.MANAGER,
        status: 'active',
      })
      .returning();
    createdUserIds.push(mgrUser.id);
    managerToken = jwtService.sign({
      sub: mgrUser.id,
      role: Role.MANAGER,
      email: mgrUser.email,
      token_type: 'access',
    });

    const [custUser] = await db
      .insert(schema.users)
      .values({
        email: `cust-prod-${Date.now()}@gramoz.com`,
        passwordHash: 'dummy-hash',
        fullName: 'Customer User',
        role: Role.CUSTOMER,
        status: 'active',
      })
      .returning();
    createdUserIds.push(custUser.id);
    customerToken = jwtService.sign({
      sub: custUser.id,
      role: Role.CUSTOMER,
      email: custUser.email,
      token_type: 'access',
    });

    // 4. Seed a test product
    const [prod] = await db
      .insert(schema.products)
      .values({
        name: 'Initial Integration Test Tee',
        slug: `init-test-tee-${Date.now()}`,
        price: '650.00',
        stock: 40,
        status: 'active',
      })
      .returning();
    seededProductId = prod.id;
    createdProductIds.push(prod.id);
  });

  afterAll(async () => {
    try {
      if (createdProductIds.length > 0) {
        for (const pid of createdProductIds) {
          await redisClient.del(`product:${pid}`);
        }
        await pool.query(
          'DELETE FROM product_variants WHERE product_id = ANY($1::uuid[])',
          [createdProductIds],
        );
        await pool.query('DELETE FROM products WHERE id = ANY($1::uuid[])', [
          createdProductIds,
        ]);
      }
      if (createdUserIds.length > 0) {
        await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [
          createdUserIds,
        ]);
      }
    } finally {
      redisService.onModuleDestroy();
      await redisClient.quit();
      await pool.end();
      if (app) {
        await app.close();
      }
    }
  });

  describe('Public Catalog Endpoints', () => {
    it('B-PRD-API-01: GET /products returns 200 with list of active products and pagination meta', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/products?limit=10',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.meta).toBeDefined();
      expect(body.meta.limit).toBe(10);
    });

    it('B-PRD-API-02: GET /products/:id returns 200 with product details and variants', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/products/${seededProductId}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(body.data.id).toBe(seededProductId);
      expect(body.data.name).toBe('Initial Integration Test Tee');
      expect(Array.isArray(body.data.variants)).toBe(true);
    });

    it('B-PRD-API-03: GET /products/:id with non-UUID returns HTTP 400 Bad Request', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/products/not-a-valid-uuid',
      });

      expect(response.statusCode).toBe(400);
    });

    it('B-PRD-API-04: GET /products/:id with non-existent UUID returns HTTP 404 Not Found', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/products/00000000-0000-0000-0000-000000000000',
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.message).toBe('Product not found');
    });
  });

  describe('Administrative Authorization Guard Boundaries', () => {
    it('B-PRD-SEC-05: POST /products without token returns HTTP 401 Unauthorized', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/products',
        payload: { name: 'Hacker Tee', price: 100, stock: 10 },
      });

      expect(response.statusCode).toBe(401);
    });

    it('B-PRD-SEC-06: POST /products with Customer token returns HTTP 403 Forbidden', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/products',
        headers: { authorization: `Bearer ${customerToken}` },
        payload: { name: 'Unauthorized Tee', price: 100, stock: 10 },
      });

      expect(response.statusCode).toBe(403);
    });

    it('B-PRD-SEC-07: PUT /products/:id with Customer token returns HTTP 403 Forbidden', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: `/products/${seededProductId}`,
        headers: { authorization: `Bearer ${customerToken}` },
        payload: { price: 10 },
      });

      expect(response.statusCode).toBe(403);
    });

    it('B-PRD-SEC-08: DELETE /products/:id with Customer token returns HTTP 403 Forbidden', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: `/products/${seededProductId}`,
        headers: { authorization: `Bearer ${customerToken}` },
      });

      expect(response.statusCode).toBe(403);
    });

    it('B-PRD-SEC-09: DELETE /products/:id with Manager token returns HTTP 403 Forbidden (only SuperAdmin/Admin)', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: `/products/${seededProductId}`,
        headers: { authorization: `Bearer ${managerToken}` },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('Full Administrative Lifecycle (Create -> Read -> Update -> Soft Delete)', () => {
    let newProductId: string;

    it('B-PRD-LIFE-01: Admin creates product with variants and saves to PostgreSQL', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/products',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Gramoz Oxford Shirt',
          price: 1350,
          stock: 35,
          description: 'Formal 100% cotton button-down',
          variants: JSON.stringify([
            {
              sku: 'OXF-BLU-M',
              price: 1350,
              stock: 15,
              attributes: { color: 'Blue', size: 'M' },
            },
            {
              sku: 'OXF-WHT-L',
              price: 1400,
              stock: 20,
              attributes: { color: 'White', size: 'L' },
            },
          ]),
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(body.data.id).toBeDefined();
      expect(body.data.name).toBe('Gramoz Oxford Shirt');

      newProductId = body.data.id;
      createdProductIds.push(newProductId);

      // Verify variants exist in DB
      const variants = await pool.query(
        'SELECT sku, price, stock FROM product_variants WHERE product_id = $1 ORDER BY sku',
        [newProductId],
      );
      expect(variants.rows).toHaveLength(2);
      expect(variants.rows[0].sku).toBe('OXF-BLU-M');
      expect(variants.rows[0].stock).toBe(15);
    });

    it('B-PRD-LIFE-02: Public user can retrieve newly created product and caches in Redis', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/products/${newProductId}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.data.variants).toHaveLength(2);

      // Verify Redis cache key product:<id> was created
      const cached = await redisClient.get(`product:${newProductId}`);
      expect(cached).not.toBeNull();
      const parsedCached = JSON.parse(cached);
      expect(parsedCached.name).toBe('Gramoz Oxford Shirt');
    });

    it('B-PRD-LIFE-03: Admin updates product price, stock, and invalidates Redis cache', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: `/products/${newProductId}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          price: 1250,
          stock: 30,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);

      // Verify Redis cache was invalidated immediately
      const cachedAfterUpdate = await redisClient.get(
        `product:${newProductId}`,
      );
      expect(cachedAfterUpdate).toBeNull();

      // Next read hits DB and populates new price in cache
      const readResponse = await app.inject({
        method: 'GET',
        url: `/products/${newProductId}`,
      });
      const readBody = JSON.parse(readResponse.payload);
      expect(readBody.data.price).toBe('1250.00');
    });

    it('B-PRD-LIFE-04: Admin soft-deletes product, invalidating cache and hiding from shop', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: `/products/${newProductId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(200);

      // Verify Redis cache is invalidated
      const cachedAfterDelete = await redisClient.get(
        `product:${newProductId}`,
      );
      expect(cachedAfterDelete).toBeNull();

      // Subsequent public detail query returns 404
      const detailResponse = await app.inject({
        method: 'GET',
        url: `/products/${newProductId}`,
      });
      expect(detailResponse.statusCode).toBe(404);

      // Verify database record has deleted_at set and status is archived
      const dbRow = await pool.query(
        'SELECT status, deleted_at FROM products WHERE id = $1',
        [newProductId],
      );
      expect(dbRow.rows[0].status).toBe('archived');
      expect(dbRow.rows[0].deleted_at).not.toBeNull();
    });
  });
});
