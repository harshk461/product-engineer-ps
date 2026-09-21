import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AppConfigService } from '../config/app-config.service';

/**
 * Runs a unit of work in a database transaction.
 *
 * On MySQL this is a straight pass-through: concurrent ingestion requests run
 * as genuinely concurrent InnoDB transactions and collide on UNIQUE(eventId),
 * which is exactly the behaviour idempotency relies on.
 *
 * SQLite (used by the test suite) has a single writer and TypeORM gives it a
 * single connection, so overlapping transactions are impossible there. Writes
 * are queued instead. This changes *when* the work runs, never what it does:
 * the unique constraint still decides who wins, and the loser still takes the
 * duplicate path.
 */
@Injectable()
export class TransactionRunner {
  private readonly serializeWrites: boolean;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly dataSource: DataSource,
    config: AppConfigService,
  ) {
    this.serializeWrites = config.database.driver === 'sqlite';
  }

  run<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    if (!this.serializeWrites) {
      return this.dataSource.transaction(work);
    }

    const result = this.queue.then(() => this.dataSource.transaction(work));
    // Keep the chain alive regardless of this unit's outcome.
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
