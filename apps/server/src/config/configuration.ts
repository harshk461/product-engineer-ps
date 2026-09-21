/**
 * Single source of truth for runtime configuration.
 *
 * Everything the engine needs to behave differently between production, a demo
 * and a test run is an environment variable. Retry delays in particular are
 * configurable so tests and demos can run with sub-second backoff.
 */

export type DatabaseDriver = 'mysql' | 'sqlite';

export interface AppConfiguration {
  env: string;
  http: {
    port: number;
    corsOrigin: string;
  };
  database: {
    driver: DatabaseDriver;
    host: string;
    port: number;
    username: string;
    password: string;
    name: string;
    logging: boolean;
    /** sqlite only: file path or ':memory:' */
    file: string;
    /** sqlite/test only: create the schema from entity metadata instead of migrations */
    synchronize: boolean;
  };
  webhook: {
    targetUrl: string;
    timeoutMs: number;
    signingSecret: string;
  };
  retry: {
    maxAttempts: number;
    /** delayMs[n] is the wait *after* attempt n+1 failed */
    delaysMs: number[];
  };
  worker: {
    enabled: boolean;
    id: string;
    pollIntervalMs: number;
    batchSize: number;
    /** A job stuck in DELIVERING longer than this is assumed to be a crashed worker. */
    leaseTimeoutMs: number;
  };
}

class ConfigurationError extends Error {}

function readString(env: NodeJS.ProcessEnv, key: string, fallback?: string): string {
  const raw = env[key];
  if (raw === undefined || raw === '') {
    if (fallback === undefined) {
      throw new ConfigurationError(`Missing required environment variable ${key}`);
    }
    return fallback;
  }
  return raw;
}

function readNumber(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new ConfigurationError(`Environment variable ${key} must be a number, got "${raw}"`);
  }
  return parsed;
}

function readBoolean(env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  if (['true', '1', 'yes'].includes(raw.toLowerCase())) return true;
  if (['false', '0', 'no'].includes(raw.toLowerCase())) return false;
  throw new ConfigurationError(`Environment variable ${key} must be a boolean, got "${raw}"`);
}

function readRetryDelays(env: NodeJS.ProcessEnv, maxAttempts: number): number[] {
  // RETRY_DELAYS_MS (comma separated) wins when present; otherwise the two
  // explicitly named delays from the spec are used.
  const list = env.RETRY_DELAYS_MS;
  const delays = list
    ? list
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => {
          const parsed = Number(value);
          if (!Number.isFinite(parsed) || parsed < 0) {
            throw new ConfigurationError(`RETRY_DELAYS_MS contains an invalid value "${value}"`);
          }
          return parsed;
        })
    : [readNumber(env, 'RETRY_DELAY_1_MS', 300_000), readNumber(env, 'RETRY_DELAY_2_MS', 1_800_000)];

  // There are (maxAttempts - 1) waits between maxAttempts attempts. If fewer
  // delays were configured, the last one is reused.
  const required = Math.max(maxAttempts - 1, 0);
  while (delays.length < required) {
    delays.push(delays[delays.length - 1] ?? 0);
  }
  return delays.slice(0, required);
}

export function buildConfiguration(env: NodeJS.ProcessEnv = process.env): AppConfiguration {
  const driver = readString(env, 'DB_DRIVER', 'mysql') as DatabaseDriver;
  if (driver !== 'mysql' && driver !== 'sqlite') {
    throw new ConfigurationError(`DB_DRIVER must be "mysql" or "sqlite", got "${driver}"`);
  }

  const maxAttempts = readNumber(env, 'MAX_ATTEMPTS', 3);
  if (maxAttempts < 1) {
    throw new ConfigurationError('MAX_ATTEMPTS must be at least 1');
  }

  const port = readNumber(env, 'PORT', 3001);

  return {
    env: readString(env, 'NODE_ENV', 'development'),
    http: {
      port,
      corsOrigin: readString(env, 'CORS_ORIGIN', '*'),
    },
    database: {
      driver,
      host: readString(env, 'DB_HOST', 'localhost'),
      port: readNumber(env, 'DB_PORT', 3306),
      username: readString(env, 'DB_USER', 'webhook'),
      password: readString(env, 'DB_PASSWORD', 'webhook'),
      name: readString(env, 'DB_NAME', 'webhook_engine'),
      logging: readBoolean(env, 'DB_LOGGING', false),
      file: readString(env, 'DB_FILE', ':memory:'),
      synchronize: readBoolean(env, 'DB_SYNCHRONIZE', driver === 'sqlite'),
    },
    webhook: {
      targetUrl: readString(env, 'WEBHOOK_TARGET_URL', `http://localhost:${port}/test-receiver/webhook`),
      timeoutMs: readNumber(env, 'WEBHOOK_TIMEOUT_MS', 5_000),
      signingSecret: readString(env, 'WEBHOOK_SIGNING_SECRET', 'dev-secret'),
    },
    retry: {
      maxAttempts,
      delaysMs: readRetryDelays(env, maxAttempts),
    },
    worker: {
      enabled: readBoolean(env, 'WORKER_ENABLED', true),
      id: readString(env, 'WORKER_ID', `worker-${process.pid}`),
      pollIntervalMs: readNumber(env, 'WORKER_POLL_INTERVAL_MS', 1_000),
      batchSize: readNumber(env, 'WORKER_BATCH_SIZE', 10),
      leaseTimeoutMs: readNumber(env, 'WORKER_LEASE_TIMEOUT_MS', 60_000),
    },
  };
}
