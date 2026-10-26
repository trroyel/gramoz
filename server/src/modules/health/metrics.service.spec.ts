import { Test, TestingModule } from '@nestjs/testing';
import { MetricsService } from './metrics.service';
import { MetricsController } from './metrics.controller';
import { DATABASE } from '../../database/database.module';
import { RedisService } from '../../cache/redis.service';
import { ConfigService } from '@config/config.service';

describe('MetricsService & MetricsController (TASK-27 Phase 6)', () => {
  let metricsService: MetricsService;
  let metricsController: MetricsController;
  let mockDb: any;
  let mockRedisService: any;
  let mockRedisClient: any;

  beforeEach(async () => {
    mockDb = {
      execute: jest.fn().mockImplementation((query) => {
        return Promise.resolve({
          rows: [{ count: 5, size: 10485760, age_seconds: 42.5 }],
        });
      }),
    };

    mockRedisClient = {
      status: 'ready',
      info: jest.fn().mockResolvedValue(`
# Memory
used_memory:1048576
maxmemory:50331648
# Stats
evicted_keys:0
# Clients
connected_clients:3
`),
    };

    mockRedisService = {
      getClient: jest.fn().mockReturnValue(mockRedisClient),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MetricsController],
      providers: [
        MetricsService,
        { provide: DATABASE, useValue: mockDb },
        { provide: RedisService, useValue: mockRedisService },
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    metricsService = module.get<MetricsService>(MetricsService);
    metricsController = module.get<MetricsController>(MetricsController);

    metricsService.onModuleInit();
  });

  afterEach(() => {
    metricsService.onModuleDestroy();
  });

  it('generates standard Prometheus exposition format with all required operational metrics', async () => {
    const output = await metricsService.getPrometheusMetrics();

    expect(output).toContain('# HELP nodejs_memory_heap_used_bytes');
    expect(output).toContain('nodejs_memory_heap_used_bytes');
    expect(output).toContain('nodejs_memory_rss_bytes');
    expect(output).toContain('nodejs_event_loop_lag_seconds');
    expect(output).toContain('pg_active_connections 5');
    expect(output).toContain('pg_database_size_bytes 10485760');
    expect(output).toContain('outbox_pending_events 5');
    expect(output).toContain('outbox_failed_events 5');
    expect(output).toContain('courier_reconciliation_backlog 5');
    expect(output).toContain('refund_reconciliation_backlog 5');
    expect(output).toContain('redis_connected 1');
    expect(output).toContain('redis_used_memory_bytes 1048576');
    expect(output).toContain('redis_max_memory_bytes 50331648');
    expect(output).toContain('redis_evicted_keys_total 0');
  });

  describe('MetricsController Access Control (TASK-27F)', () => {
    it('allows authorized loopback scraper and responds with Content-Type text/plain; version=0.0.4', async () => {
      const mockReq: any = {
        headers: {},
        ip: '127.0.0.1',
      };
      const mockRes: any = {
        status: jest.fn().mockReturnThis(),
        header: jest.fn().mockReturnThis(),
        send: jest.fn((body) => body),
      };

      await metricsController.getMetricsRoot(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.header).toHaveBeenCalledWith(
        'Content-Type',
        'text/plain; version=0.0.4; charset=utf-8',
      );
      expect(mockRes.send).toHaveBeenCalled();
    });

    it('rejects unauthorized scraper from public IP with HTTP 403 Forbidden', async () => {
      const mockReq: any = {
        headers: {},
        ip: '198.51.100.22', // external public IP
      };
      const mockRes: any = {
        status: jest.fn().mockReturnThis(),
        header: jest.fn().mockReturnThis(),
        send: jest.fn((body) => body),
      };

      await metricsController.getMetricsRoot(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.send).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: expect.stringContaining(
            'restricted to authorized monitoring scrapers',
          ),
        }),
      );
    });

    it('allows external scraper when valid x-metrics-token header matches METRICS_TOKEN', async () => {
      process.env.METRICS_TOKEN = 'test-metrics-token-9988';
      const mockReq: any = {
        headers: {
          'x-metrics-token': 'test-metrics-token-9988',
        },
        ip: '198.51.100.22',
      };
      const mockRes: any = {
        status: jest.fn().mockReturnThis(),
        header: jest.fn().mockReturnThis(),
        send: jest.fn((body) => body),
      };

      try {
        await metricsController.getMetricsRoot(mockReq, mockRes);
        expect(mockRes.status).toHaveBeenCalledWith(200);
        expect(mockRes.send).toHaveBeenCalled();
      } finally {
        delete process.env.METRICS_TOKEN;
      }
    });

    it('rejects external scraper with invalid x-metrics-token with HTTP 403 Forbidden', async () => {
      process.env.METRICS_TOKEN = 'real-secret-token-1234';
      const mockReq: any = {
        headers: {
          'x-metrics-token': 'attacker-forged-token',
        },
        ip: '198.51.100.22',
      };
      const mockRes: any = {
        status: jest.fn().mockReturnThis(),
        header: jest.fn().mockReturnThis(),
        send: jest.fn((body) => body),
      };

      try {
        await metricsController.getMetricsRoot(mockReq, mockRes);
        expect(mockRes.status).toHaveBeenCalledWith(403);
      } finally {
        delete process.env.METRICS_TOKEN;
      }
    });

    it('prevents IP spoofing via X-Forwarded-For when client IP is external', async () => {
      // Attacker sends X-Forwarded-For: 127.0.0.1, but reverse proxy / trustProxy resolves real client IP
      const mockReq: any = {
        headers: {
          'x-forwarded-for': '127.0.0.1',
          'x-real-ip': '127.0.0.1',
        },
        ip: '198.51.100.44', // actual resolved client IP from Fastify trustProxy
      };
      const mockRes: any = {
        status: jest.fn().mockReturnThis(),
        header: jest.fn().mockReturnThis(),
        send: jest.fn((body) => body),
      };

      await metricsController.getMetricsRoot(mockReq, mockRes);
      expect(mockRes.status).toHaveBeenCalledWith(403);
    });

    it('enforces same strict access control on /health/metrics endpoint', async () => {
      const unauthorizedReq: any = {
        headers: {},
        ip: '203.0.113.88',
      };
      const mockRes: any = {
        status: jest.fn().mockReturnThis(),
        header: jest.fn().mockReturnThis(),
        send: jest.fn((body) => body),
      };

      await metricsController.getMetricsHealth(unauthorizedReq, mockRes);
      expect(mockRes.status).toHaveBeenCalledWith(403);

      // Authorized internal query
      const authorizedReq: any = {
        headers: {},
        ip: '127.0.0.1',
      };
      const authorizedRes: any = {
        status: jest.fn().mockReturnThis(),
        header: jest.fn().mockReturnThis(),
        send: jest.fn((body) => body),
      };

      await metricsController.getMetricsHealth(authorizedReq, authorizedRes);
      expect(authorizedRes.status).toHaveBeenCalledWith(200);
      expect(authorizedRes.header).toHaveBeenCalledWith(
        'Content-Type',
        'text/plain; version=0.0.4; charset=utf-8',
      );
    });
  });
});
