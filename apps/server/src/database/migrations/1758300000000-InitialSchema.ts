import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Initial MySQL schema.
 *
 * Written as explicit DDL rather than generated, because two details are
 * load-bearing and should be readable:
 *   - UNIQUE(eventId) on `events` is the idempotency guarantee.
 *   - UNIQUE(eventId) on `delivery_jobs` is what makes "one logical event,
 *     one delivery job" impossible to violate, even under concurrent ingestion.
 *
 * Status columns are VARCHAR rather than ENUM so adding a state is a code
 * change, not a table rewrite.
 */
export class InitialSchema1758300000000 implements MigrationInterface {
  name = 'InitialSchema1758300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`events\` (
        \`id\` char(36) NOT NULL,
        \`eventId\` varchar(128) NOT NULL,
        \`type\` varchar(128) NOT NULL,
        \`occurredAt\` datetime(3) NOT NULL,
        \`payload\` json NOT NULL,
        \`status\` varchar(32) NOT NULL DEFAULT 'PENDING',
        \`createdAt\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updatedAt\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`uq_events_event_id\` (\`eventId\`),
        INDEX \`idx_events_status\` (\`status\`),
        INDEX \`idx_events_created_at\` (\`createdAt\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`
      CREATE TABLE \`delivery_jobs\` (
        \`id\` char(36) NOT NULL,
        \`eventId\` varchar(128) NOT NULL,
        \`status\` varchar(32) NOT NULL DEFAULT 'PENDING',
        \`attemptCount\` int NOT NULL DEFAULT 0,
        \`nextAttemptAt\` datetime(3) NOT NULL,
        \`lockedAt\` datetime(3) NULL,
        \`lockedBy\` varchar(64) NULL,
        \`createdAt\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updatedAt\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`uq_delivery_jobs_event_id\` (\`eventId\`),
        INDEX \`idx_delivery_jobs_status_next_attempt\` (\`status\`, \`nextAttemptAt\`),
        INDEX \`idx_delivery_jobs_locked_at\` (\`lockedAt\`),
        CONSTRAINT \`fk_delivery_jobs_event\` FOREIGN KEY (\`eventId\`)
          REFERENCES \`events\` (\`eventId\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`
      CREATE TABLE \`delivery_attempts\` (
        \`id\` char(36) NOT NULL,
        \`eventId\` varchar(128) NOT NULL,
        \`attemptNumber\` int NOT NULL,
        \`startedAt\` datetime(3) NOT NULL,
        \`completedAt\` datetime(3) NULL,
        \`status\` varchar(32) NOT NULL,
        \`httpStatus\` int NULL,
        \`errorType\` varchar(32) NULL,
        \`errorMessage\` text NULL,
        \`createdAt\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`uq_delivery_attempts_event_attempt\` (\`eventId\`, \`attemptNumber\`),
        INDEX \`idx_delivery_attempts_event_id\` (\`eventId\`),
        CONSTRAINT \`fk_delivery_attempts_event\` FOREIGN KEY (\`eventId\`)
          REFERENCES \`events\` (\`eventId\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE `delivery_attempts`');
    await queryRunner.query('DROP TABLE `delivery_jobs`');
    await queryRunner.query('DROP TABLE `events`');
  }
}
