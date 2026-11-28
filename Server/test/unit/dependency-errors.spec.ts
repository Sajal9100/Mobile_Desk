import { describe, expect, it } from 'vitest';
import { toApiError } from '../../src/common/errors/all-exceptions.filter.js';

/** An error shaped like the ones Prisma 7 + the pg adapter really throw (observed, see the filter). */
function prismaError(name: string, code: string | undefined, message = ''): Error {
  const error = new Error(message);
  error.name = name;
  if (code !== undefined) Object.assign(error, { code });
  return error;
}

describe('dependency outages are a retryable 503 (rule 9: fail closed)', () => {
  it.each([
    ['Postgres never reachable (P1001)', prismaError('PrismaClientKnownRequestError', 'P1001')],
    [
      'Postgres went away: socket code on a Prisma error',
      prismaError('PrismaClientKnownRequestError', 'ECONNREFUSED'),
    ],
    [
      'Postgres went away inside a transaction (AggregateError)',
      prismaError('AggregateError', 'ECONNREFUSED'),
    ],
    ['connection pool exhausted (P2024)', prismaError('PrismaClientKnownRequestError', 'P2024')],
    ['server shutting down (57P01)', prismaError('Error', '57P01')],
    ['too many connections (53300)', prismaError('Error', '53300')],
    ['a pooled connection killed by the server', new Error('Connection terminated unexpectedly')],
    ['pool connect timeout', new Error('timeout exceeded when trying to connect')],
    ['Prisma initialization error', prismaError('PrismaClientInitializationError', undefined, 'x')],
    ['Redis connection refused', prismaError('Error', 'ECONNRESET')],
  ])('%s', (_name, error) => {
    expect(toApiError(error)).toMatchObject({ status: 503, code: 'service_unavailable' });
  });

  it('follows a wrapped cause', () => {
    const wrapped = new Error('query failed', {
      cause: new Error('Connection terminated unexpectedly'),
    });
    expect(toApiError(wrapped)).toMatchObject({ status: 503 });
  });

  it.each([
    [
      'a unique-constraint violation is a bug if it escapes',
      prismaError('PrismaClientKnownRequestError', 'P2002', 'Unique constraint failed'),
    ],
    ['a record that is not found', prismaError('PrismaClientKnownRequestError', 'P2025')],
    ['an ordinary error', new Error('something broke')],
    ['a TypeError', new TypeError('x is undefined')],
    ['a string', 'Connection terminated unexpectedly'],
    ['null', null],
  ])('%s stays a 500', (_name, error) => {
    expect(toApiError(error)).toMatchObject({ status: 500, code: 'internal_error' });
  });

  it('the client never sees the driver message', () => {
    const body = toApiError(new Error('Connection terminated unexpectedly host=db.internal'));
    expect(JSON.stringify(body)).not.toContain('db.internal');
    expect(body.message).toBe('Service temporarily unavailable');
  });
});
