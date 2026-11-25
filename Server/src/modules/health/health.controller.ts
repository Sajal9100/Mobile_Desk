import { Controller, Get, Inject } from '@nestjs/common';
import { ReadinessService, type ReadinessReport } from './readiness.service.js';

@Controller()
export class HealthController {
  constructor(@Inject(ReadinessService) private readonly readiness: ReadinessService) {}

  /** Liveness: the process is up. Touches no dependency. */
  @Get('health')
  health(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Readiness: Postgres and Redis answer within 1 s each, otherwise 503. */
  @Get('ready')
  ready(): Promise<ReadinessReport> {
    return this.readiness.check();
  }
}
