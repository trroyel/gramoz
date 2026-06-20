import { Injectable } from '@nestjs/common';
import {
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';

@Injectable()
export class NativeHttpHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async isHealthy(key: string, url: string): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);
    try {
      const res = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });

      const isHealthy = res.status < 500;

      if (isHealthy) {
        return indicator.up({ statusCode: res.status });
      }
      return indicator.down({ statusCode: res.status });
    } catch (e: any) {
      return indicator.down({ message: e.message });
    }
  }
}
