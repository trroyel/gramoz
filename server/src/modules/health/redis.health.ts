import { Injectable } from '@nestjs/common';
import {
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { RedisService } from '@cache/redis.service';

@Injectable()
export class RedisHealthIndicator {
  constructor(
    private readonly redis: RedisService,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);
    try {
      await this.redis.ping();
      return indicator.up();
    } catch (error) {
      return indicator.down({ error: (error as Error).message });
    }
  }
}
