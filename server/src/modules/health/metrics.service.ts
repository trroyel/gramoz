import {
  Injectable,
  Inject,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { monitorEventLoopDelay, IntervalHistogram } from 'perf_hooks';
import { DATABASE } from '../../database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../database/schema';
import { sql } from 'drizzle-orm';
import { RedisService } from '../../cache/redis.service';

@Injectable()
export class MetricsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MetricsService.name);
  private histogram?: IntervalHistogram;

  constructor(
    @Inject(DATABASE) private readonly db: NodePgDatabase<typeof schema>,
    private readonly redisService: RedisService,
  ) {}

  onModuleInit() {
    try {
      this.histogram = monitorEventLoopDelay({ resolution: 20 });
      this.histogram.enable();
    } catch (err: unknown) {
      this.logger.warn(
        `Could not initialize event loop delay histogram: ${err}`,
      );
    }
  }

  onModuleDestroy() {
    try {
      this.histogram?.disable();
    } catch (_) {}
  }

  async getPrometheusMetrics(): Promise<string> {
    const lines: string[] = [];

    // Helper to format Prometheus gauge
    const addGauge = (name: string, help: string, value: number) => {
      lines.push(`# HELP ${name} ${help}`);
      lines.push(`# TYPE ${name} gauge`);
      lines.push(`${name} ${Number.isFinite(value) ? value : 0}`);
      lines.push('');
    };

    // Helper to format Prometheus counter
    const addCounter = (name: string, help: string, value: number) => {
      lines.push(`# HELP ${name} ${help}`);
      lines.push(`# TYPE ${name} counter`);
      lines.push(`${name} ${Number.isFinite(value) ? value : 0}`);
      lines.push('');
    };

    // 1. Process & Memory Metrics
    const mem = process.memoryUsage();
    addGauge(
      'nodejs_memory_heap_used_bytes',
      'Node.js heap memory used in bytes',
      mem.heapUsed,
    );
    addGauge(
      'nodejs_memory_heap_total_bytes',
      'Node.js heap memory total allocated in bytes',
      mem.heapTotal,
    );
    addGauge(
      'nodejs_memory_rss_bytes',
      'Node.js process resident set size (RSS) in bytes',
      mem.rss,
    );
    addGauge(
      'nodejs_memory_external_bytes',
      'Node.js process external memory in bytes',
      mem.external,
    );
    addGauge(
      'process_uptime_seconds',
      'Node.js process uptime in seconds',
      process.uptime(),
    );

    // Event Loop Lag
    if (this.histogram) {
      const meanSeconds = this.histogram.mean / 1e9;
      const maxSeconds = this.histogram.max / 1e9;
      addGauge(
        'nodejs_event_loop_lag_seconds',
        'Node.js event loop delay average in seconds',
        meanSeconds,
      );
      addGauge(
        'nodejs_event_loop_lag_max_seconds',
        'Node.js event loop delay maximum in seconds',
        maxSeconds,
      );
    }

    // 2. PostgreSQL Database Metrics
    try {
      const connRes = await this.db.execute<{ count: number }>(
        sql`SELECT count(*)::int as count FROM pg_stat_activity WHERE datname = current_database()`,
      );
      addGauge(
        'pg_active_connections',
        'Current active connections to the PostgreSQL database',
        (connRes.rows[0] as any)?.count ?? 0,
      );

      const dbSizeRes = await this.db.execute<{ size: number }>(
        sql`SELECT pg_database_size(current_database())::bigint as size`,
      );
      addGauge(
        'pg_database_size_bytes',
        'PostgreSQL database disk usage in bytes',
        Number((dbSizeRes.rows[0] as any)?.size ?? 0),
      );

      // Outbox status metrics
      const outboxPending = await this.db.execute<{ count: number }>(
        sql`SELECT count(*)::int as count FROM outbox_events WHERE status = 'pending'`,
      );
      addGauge(
        'outbox_pending_events',
        'Number of pending outbox events awaiting dispatch',
        (outboxPending.rows[0] as any)?.count ?? 0,
      );

      const outboxProcessing = await this.db.execute<{ count: number }>(
        sql`SELECT count(*)::int as count FROM outbox_events WHERE status = 'processing'`,
      );
      addGauge(
        'outbox_processing_events',
        'Number of outbox events currently being processed',
        (outboxProcessing.rows[0] as any)?.count ?? 0,
      );

      const outboxFailed = await this.db.execute<{ count: number }>(
        sql`SELECT count(*)::int as count FROM outbox_events WHERE status = 'failed'`,
      );
      addGauge(
        'outbox_failed_events',
        'Number of dead-lettered / failed outbox events',
        (outboxFailed.rows[0] as any)?.count ?? 0,
      );

      const outboxAgeRes = await this.db.execute<{ age_seconds: number }>(
        sql`SELECT COALESCE(EXTRACT(EPOCH FROM (NOW() - MIN(created_at))), 0)::float as age_seconds 
            FROM outbox_events WHERE status = 'pending'`,
      );
      addGauge(
        'outbox_oldest_pending_age_seconds',
        'Age of oldest pending outbox event in seconds',
        Number((outboxAgeRes.rows[0] as any)?.age_seconds ?? 0),
      );

      // Courier reconciliation backlog
      const courierBacklog = await this.db.execute<{ count: number }>(
        sql`SELECT count(*)::int as count FROM outbox_events 
            WHERE type = 'CREATE_CONSIGNMENT' 
              AND (status = 'failed' OR last_error LIKE '%RECONCILIATION_REQUIRED%')`,
      );
      addGauge(
        'courier_reconciliation_backlog',
        'Unresolved courier dispatches requiring administrative reconciliation',
        (courierBacklog.rows[0] as any)?.count ?? 0,
      );

      // Refunds pending / in-doubt backlog
      const refundsBacklog = await this.db.execute<{ count: number }>(
        sql`SELECT count(*)::int as count FROM refunds WHERE status IN ('pending', 'processing')`,
      );
      addGauge(
        'refund_reconciliation_backlog',
        'Pending or in-doubt refund requests awaiting processing or reconciliation',
        (refundsBacklog.rows[0] as any)?.count ?? 0,
      );
    } catch (err: unknown) {
      this.logger.warn(`Failed to collect PostgreSQL metrics: ${err}`);
    }

    // 3. Redis Metrics
    try {
      const client = this.redisService.getClient();
      const infoRaw = await client.info();
      addGauge(
        'redis_connected',
        'Redis connection status (1 = connected, 0 = disconnected)',
        client.status === 'ready' ? 1 : 0,
      );

      const usedMemoryMatch = infoRaw.match(/used_memory:(\d+)/);
      if (usedMemoryMatch) {
        addGauge(
          'redis_used_memory_bytes',
          'Redis memory used in bytes',
          parseInt(usedMemoryMatch[1], 10),
        );
      }

      const maxMemoryMatch = infoRaw.match(/maxmemory:(\d+)/);
      if (maxMemoryMatch) {
        addGauge(
          'redis_max_memory_bytes',
          'Redis maxmemory configuration in bytes',
          parseInt(maxMemoryMatch[1], 10),
        );
      }

      const evictedKeysMatch = infoRaw.match(/evicted_keys:(\d+)/);
      if (evictedKeysMatch) {
        addCounter(
          'redis_evicted_keys_total',
          'Total number of evicted keys due to maxmemory limit',
          parseInt(evictedKeysMatch[1], 10),
        );
      }

      const connectedClientsMatch = infoRaw.match(/connected_clients:(\d+)/);
      if (connectedClientsMatch) {
        addGauge(
          'redis_connected_clients',
          'Number of client connections to Redis',
          parseInt(connectedClientsMatch[1], 10),
        );
      }
    } catch (err: unknown) {
      addGauge(
        'redis_connected',
        'Redis connection status (1 = connected, 0 = disconnected)',
        0,
      );
      this.logger.warn(`Failed to collect Redis metrics: ${err}`);
    }

    return lines.join('\n');
  }
}
