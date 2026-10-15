import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import type { Env } from './config/env';
import { AllExceptionsFilter } from './platform/http/all-exceptions.filter';
import { buildValidationPipe } from './platform/http/validation';

/** HTTP setup shared by main.ts and the end-to-end tests, so both run the API exactly the same way. */
export function configureApp(app: INestApplication): void {
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  app.setGlobalPrefix('api/v1');
  app.enableCors({
    origin: config
      .get('CORS_ORIGIN', { infer: true })
      .split(',')
      .map((o) => o.trim()),
    exposedHeaders: ['Content-Disposition'],
    // The refresh-token cookie travels with sign-in requests (AUTH_MODE=jwt).
    credentials: true,
  });
  app.use(cookieParser());
  app.useGlobalPipes(buildValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());
}
