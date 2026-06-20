import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  MemoryHealthIndicator,
  DiskHealthIndicator,
} from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';
import { DatabaseHealthIndicator } from './database.health';
import { RedisHealthIndicator } from './redis.health';
import { NativeHttpHealthIndicator } from './http.health';

@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: DatabaseHealthIndicator,
    private readonly redis: RedisHealthIndicator,
    private readonly memory: MemoryHealthIndicator,
    private readonly disk: DiskHealthIndicator,
    private readonly http: NativeHttpHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.db.isHealthy('database'),
      () => this.redis.isHealthy('redis'),
      // The process should not use more than 300MB memory
      () => this.memory.checkHeap('memory_heap', 300 * 1024 * 1024),
      // The process should not have more than 300MB RSS memory allocated
      () => this.memory.checkRSS('memory_rss', 300 * 1024 * 1024),
      // The used disk storage should not exceed 90% of the full disk size
      () =>
        this.disk.checkStorage('disk', { path: '/', thresholdPercent: 0.9 }),
      // Ping Resend Email API
      () => this.http.isHealthy('resend_api', 'https://api.resend.com'),
      // Ping SSLCommerz API
      () =>
        this.http.isHealthy('sslcommerz_api', 'https://sandbox.sslcommerz.com'),
    ]);
  }
}
