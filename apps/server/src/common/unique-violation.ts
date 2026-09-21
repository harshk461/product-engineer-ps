import { QueryFailedError } from 'typeorm';

/**
 * Recognise a unique-constraint violation across MySQL and SQLite.
 *
 * Idempotency is enforced by the database, so this check is how the
 * application learns that it lost an ingestion race -- not a pre-flight
 * SELECT, which would be racy by construction.
 */
export function isUniqueViolation(error: unknown): boolean {
  if (!(error instanceof QueryFailedError)) return false;

  const driverError = error.driverError as { code?: string; errno?: number } | undefined;
  const code = driverError?.code;

  if (code === 'ER_DUP_ENTRY' || driverError?.errno === 1062) return true;
  if (code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY') return true;
  return /unique constraint failed|duplicate entry/i.test(error.message);
}
