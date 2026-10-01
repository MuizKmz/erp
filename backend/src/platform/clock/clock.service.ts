import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { BUSINESS_TIMEZONE, businessDate, dateOnly, shiftToDate } from './clock.rules';

/**
 * The one place that knows what "today" is. Business logic asks the clock instead of `new Date()`, so
 * DEV_TODAY can pin the demo to Tuesday 29 Sep 2026 and tests can fix the date.
 */
@Injectable()
export class ClockService {
  private readonly fixedDate: string | null;

  constructor(config: ConfigService<Env, true>) {
    this.fixedDate = config.get('DEV_TODAY', { infer: true });
    if (this.fixedDate) new Logger(ClockService.name).warn(`DEV_TODAY is set: today is ${this.fixedDate}`);
  }

  /** The current moment (with the date replaced when DEV_TODAY is set). */
  now(): Date {
    const real = new Date();
    return this.fixedDate ? shiftToDate(real, this.fixedDate) : real;
  }

  /** Today in the business timezone, YYYY-MM-DD. */
  today(): string {
    return this.fixedDate ?? businessDate(new Date());
  }

  /** Today as a DATE value for Prisma queries. */
  todayDate(): Date {
    return dateOnly(this.today());
  }

  get timeZone(): string {
    return BUSINESS_TIMEZONE;
  }

  get isFixed(): boolean {
    return this.fixedDate !== null;
  }
}

@Global()
@Module({ providers: [ClockService], exports: [ClockService] })
export class ClockModule {}
