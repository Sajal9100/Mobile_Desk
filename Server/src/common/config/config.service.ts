import { Global, Module } from '@nestjs/common';
import type { AppConfig } from './config.schema.js';

/** Typed, read-only view of the validated configuration. */
export class ConfigService {
  constructor(private readonly values: Readonly<AppConfig>) {}

  get<K extends keyof AppConfig>(key: K): AppConfig[K] {
    return this.values[key];
  }
}

// The process validates its configuration exactly once, at the entry point, before anything else
// starts (main-*.ts calls setRuntimeConfig). Modules then read it through ConfigService.
let runtimeConfig: AppConfig | undefined;

export function setRuntimeConfig(config: AppConfig): void {
  runtimeConfig = config;
}

export function getRuntimeConfig(): AppConfig {
  if (runtimeConfig === undefined) {
    throw new Error('Configuration has not been loaded. Call loadConfigOrExit() first.');
  }
  return runtimeConfig;
}

@Global()
@Module({
  providers: [{ provide: ConfigService, useFactory: () => new ConfigService(getRuntimeConfig()) }],
  exports: [ConfigService],
})
export class ConfigModule {}
