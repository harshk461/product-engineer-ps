/**
 * Test environment.
 *
 * Runs on an in-memory SQLite database so `npm test` needs no infrastructure,
 * and with zero retry backoff so the suite can drive the engine tick by tick
 * instead of sleeping. Individual tests override what they need.
 */
process.env.NODE_ENV = 'test';
process.env.DB_DRIVER = 'sqlite';
process.env.DB_FILE = ':memory:';
process.env.DB_SYNCHRONIZE = 'true';
process.env.DB_LOGGING = 'false';
process.env.WORKER_ENABLED = 'false';
process.env.MAX_ATTEMPTS = process.env.MAX_ATTEMPTS ?? '3';
process.env.RETRY_DELAY_1_MS = '0';
process.env.RETRY_DELAY_2_MS = '0';
process.env.WEBHOOK_TIMEOUT_MS = '1000';
process.env.WEBHOOK_TARGET_URL = 'http://localhost:1/never-used';
process.env.WORKER_LEASE_TIMEOUT_MS = '60000';
