import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { ConfigService } from '@config/config.service';
import { join } from 'path';
import multipart from '@fastify/multipart';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  await app.register(multipart);

  app.useStaticAssets({
    root: join(process.cwd(), 'public'),
    prefix: '/public/',
  });

  const config = app.get(ConfigService);

  // Global prefix with versioning
  app.setGlobalPrefix('api/v1');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  await app.listen(config.port);
  console.log(`🚀 Server running on http://localhost:${config.port}/api/v1`);
}
bootstrap();
