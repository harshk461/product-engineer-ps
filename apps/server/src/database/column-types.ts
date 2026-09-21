import { ColumnType } from 'typeorm';

/**
 * Entity metadata is evaluated at import time, before Nest's DI container
 * exists, so the driver is read straight from the environment here.
 *
 * MySQL is the production database. SQLite is used by the test suite so
 * `npm test` needs no infrastructure; the only schema-level difference is the
 * JSON column, which TypeORM spells differently per driver.
 */
const driver = process.env.DB_DRIVER ?? 'mysql';

export const isSqlite = driver === 'sqlite';

export const JSON_COLUMN_TYPE: ColumnType = isSqlite ? 'simple-json' : 'json';

/**
 * Timestamps are stored with millisecond precision. Retry scheduling compares
 * `nextAttemptAt` to "now", and second precision would make short demo delays
 * behave unpredictably.
 */
export const TIMESTAMP_PRECISION = 3;
