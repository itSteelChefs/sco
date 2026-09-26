import './observability/sentry.js';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { ApiValidationPipe } from './common/http/validation-pipe.js';
import { StructuredLogger } from './observability/structured-logger.js';
export async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: new StructuredLogger() });
  app.enableShutdownHooks();
  app.setGlobalPrefix('');
  app.useGlobalPipes(new ApiValidationPipe());
  await app.listen(Number(process.env.PORT ?? 3101), '0.0.0.0');
  return app;
}
if (process.env.NODE_ENV !== 'test') bootstrap();
