import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { ConfigService } from '@config/config.service';
import { join } from 'path';
import multipart from '@fastify/multipart';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';

import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      // Trust the immediate 1st hop upstream reverse proxy (Nginx, Cloudflare, AWS ALB, Ingress).
      // Prevents client-controlled X-Forwarded-For header spoofing while correctly resolving real client IP.
      trustProxy: 1,
    }),
  );

  const config = app.get(ConfigService);

  // ── Security headers (Helmet) ───────────────────────────────────────────
  await app.register(helmet, {
    // Allow same-origin iframes (needed for payment gateway redirects)
    frameguard: { action: 'sameorigin' },
    // Content Security Policy — tighten further once frontend assets are on CDN
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"], // relax for Next.js inline scripts
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'", config.frontendUrl],
      },
    },
  });

  // ── Cookie plugin (required for httpOnly auth cookies) ──────────────────
  await app.register(cookie, {
    secret: config.cookieSecret,
  });

  // ── File uploads ────────────────────────────────────────────────────────
  await app.register(multipart, {
    limits: {
      fileSize: 2 * 1024 * 1024, // 2 MB per file limit
      files: 5, // max 5 files per request (aligned with FastifyFileUploadInterceptor)
      fields: 20, // max 20 non-file fields
    },
  });

  // ── Static assets ───────────────────────────────────────────────────────
  app.useStaticAssets({
    root: join(process.cwd(), 'public'),
    prefix: '/public/',
  });

  // ── CORS — only allow the configured frontend origin ────────────────────
  app.enableCors({
    origin: config.frontendUrl,
    credentials: true, // Required for httpOnly cookies
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // ── Global prefix + pipes ───────────────────────────────────────────────
  app.setGlobalPrefix('api/v1', {
    exclude: [
      'metrics',
      'api/v1/metrics',
      'health/metrics',
      'api/v1/health/metrics',
    ],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip unknown fields
      forbidNonWhitelisted: true, // AND reject the request if any are present
      transform: true,
    }),
  );

  app.useGlobalInterceptors(new TransformInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());

  // Graceful shutdown hooks: ensures SIGTERM/SIGINT drains connections and runs onModuleDestroy
  app.enableShutdownHooks();

  await app.listen(config.port, '0.0.0.0');
  logger.log(`🚀 Server running on http://localhost:${config.port}/api/v1`);
}

bootstrap().catch((err: Error) => {
  const logger = new Logger('Bootstrap');
  logger.error(`Fatal application startup failure: ${err.message}`);
  process.exit(1);
});
