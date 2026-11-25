import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client.js';
import { ConfigService } from '../config/config.service.js';

/**
 * Prisma 7 connects through a driver adapter; the URL comes from validated config, not the schema.
 * The connection is opened lazily on first query, so a process can start (and report "not ready")
 * while Postgres is down instead of crash-looping.
 *
 * Controllers never use this directly (conventions): services own the data access.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(ConfigService) config: ConfigService) {
    super({
      adapter: new PrismaPg({
        connectionString: config.get('DATABASE_URL'),
        max: 10,
        connectionTimeoutMillis: 2_000,
        idleTimeoutMillis: 30_000,
      }),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
