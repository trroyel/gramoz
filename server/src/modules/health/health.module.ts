import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { DatabaseHealthIndicator } from './database.health';
import { RedisHealthIndicator } from './redis.health';
import { NativeHttpHealthIndicator } from './http.health';
import { DatabaseModule } from '@database/database.module';
import { RedisModule } from '@cache/redis.module';

@Module({
  imports: [TerminusModule, DatabaseModule, RedisModule],
  controllers: [HealthController],
  providers: [
    DatabaseHealthIndicator,
    RedisHealthIndicator,
    NativeHttpHealthIndicator,
  ],
})
export class HealthModule {}
