import { Controller, Get, Req, Res, HttpStatus } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { MetricsService } from './metrics.service';

@SkipThrottle()
@Controller()
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  private isAuthorizedScraper(req: FastifyRequest): boolean {
    const metricsSecret =
      process.env.METRICS_SECRET || process.env.METRICS_TOKEN || '';
    const authHeader = req.headers['authorization'] || '';
    const secretHeader =
      (req.headers['x-metrics-secret'] as string) ||
      (req.headers['x-metrics-token'] as string) ||
      '';

    // 1. If explicit token is configured and matches, authorize
    if (metricsSecret) {
      if (
        secretHeader === metricsSecret ||
        authHeader === `Bearer ${metricsSecret}`
      ) {
        return true;
      }
    }

    // 2. Allow requests originating from loopback
    const ip = req.ip || req.socket?.remoteAddress || '';
    const isLoopback =
      ip === '127.0.0.1' || ip === '::1' || ip.includes('127.0.0.1');
    if (isLoopback) {
      return true;
    }

    // 3. Allow internal private subnets (Docker internal-net) when no secret is explicitly configured
    if (!metricsSecret) {
      const isPrivateSubnet =
        ip.startsWith('10.') ||
        ip.startsWith('172.') ||
        ip.startsWith('192.168.');
      if (isPrivateSubnet) {
        return true;
      }
    }

    return false;
  }

  @Get(['metrics', 'api/v1/metrics'])
  async getMetricsRoot(@Req() req: FastifyRequest, @Res() res: FastifyReply) {
    if (!this.isAuthorizedScraper(req)) {
      return res.status(HttpStatus.FORBIDDEN).send({
        success: false,
        message:
          'Access to operational metrics is restricted to authorized monitoring scrapers',
      });
    }

    const data = await this.metricsService.getPrometheusMetrics();
    return res
      .status(HttpStatus.OK)
      .header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
      .send(data);
  }

  @Get(['health/metrics', 'api/v1/health/metrics'])
  async getMetricsHealth(@Req() req: FastifyRequest, @Res() res: FastifyReply) {
    if (!this.isAuthorizedScraper(req)) {
      return res.status(HttpStatus.FORBIDDEN).send({
        success: false,
        message:
          'Access to operational metrics is restricted to authorized monitoring scrapers',
      });
    }

    const data = await this.metricsService.getPrometheusMetrics();
    return res
      .status(HttpStatus.OK)
      .header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
      .send(data);
  }
}
