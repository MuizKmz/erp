import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { Public } from '../platform/context/context.decorators';
import { PrismaService } from '../platform/prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** 200 when the API and MySQL are up; 503 with database "down" otherwise. */
  @Public()
  @Get()
  async check() {
    const started = Date.now();
    let database: 'up' | 'down' = 'up';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'down';
    }
    const body = {
      status: database === 'up' ? 'ok' : 'degraded',
      database,
      databaseMs: Date.now() - started,
      authMode: this.config.get('AUTH_MODE', { infer: true }),
      time: new Date().toISOString(),
    };
    if (database === 'down') {
      throw new HttpException({ code: 'DB_UNAVAILABLE', message: 'The database cannot be reached.', ...body }, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return body;
  }
}
