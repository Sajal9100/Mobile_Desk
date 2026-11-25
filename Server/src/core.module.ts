import { Global, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ConfigModule } from './common/config/config.service.js';
import { PrismaService } from './common/database/prisma.service.js';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter.js';
import { LoggerModule } from './common/logger.module.js';
import { RedisService } from './common/redis/redis.service.js';

/**
 * Shared infrastructure for all three processes (api, realtime, worker): config, logger,
 * Postgres, Redis and the global error filter. Domain modules import nothing from here
 * explicitly: it is global.
 */
@Global()
@Module({
  imports: [ConfigModule, LoggerModule],
  providers: [PrismaService, RedisService, { provide: APP_FILTER, useClass: AllExceptionsFilter }],
  exports: [PrismaService, RedisService],
})
export class CoreModule {}
