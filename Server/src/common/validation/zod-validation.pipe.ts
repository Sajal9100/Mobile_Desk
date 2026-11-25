import { Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';
import { AppException } from '../errors/app.exception.js';

/**
 * Validates a request body/query/param against a zod schema (rule 6).
 *
 * Define object schemas with `z.strictObject({...})` so unknown keys are rejected, not ignored.
 * The error message lists field paths and zod issue codes only: never the submitted values.
 *
 *   @Post() create(@Body(new ZodValidationPipe(createThingSchema)) body: CreateThing) {}
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (result.success) {
      return result.data;
    }
    const problems = result.error.issues
      .slice(0, 10)
      .map((issue) => `${issue.path.map(String).join('.') || '(body)'}: ${issue.code}`);
    throw AppException.validationFailed(`Request validation failed: ${problems.join('; ')}`);
  }
}
