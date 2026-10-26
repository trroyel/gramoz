import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { DatabaseHealthIndicator } from './database.health';
import { RedisHealthIndicator } from './redis.health';
import { NativeHttpHealthIndicator } from './http.health';
import { DatabaseModule } from '@database/database.module';
import { RedisModule } from '@cache/redis.module';

@Module({
  imports: [TerminusModule, DatabaseModule, RedisModule],
  controllers: [HealthController, MetricsController],
  providers: [
    DatabaseHealthIndicator,
    RedisHealthIndicator,
    NativeHttpHealthIndicator,
    MetricsService,
  ],
  exports: [MetricsService],
})
export class HealthModule {}
