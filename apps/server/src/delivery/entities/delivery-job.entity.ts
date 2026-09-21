import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DeliveryStatus } from '../../common/delivery-status.enum';
import { TIMESTAMP_PRECISION } from '../../database/column-types';

/**
 * The unit of scheduled work. One row per event (UNIQUE on eventId), which is
 * what makes "3 submissions -> 1 delivery job" true at the schema level.
 *
 * This table *is* the queue. There is no in-memory queue anywhere in the
 * system: if the process dies, every scheduled delivery still exists here.
 */
@Entity('delivery_jobs')
@Index('idx_delivery_jobs_status_next_attempt', ['status', 'nextAttemptAt'])
@Index('idx_delivery_jobs_locked_at', ['lockedAt'])
export class DeliveryJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('uq_delivery_jobs_event_id', { unique: true })
  @Column({ type: 'varchar', length: 128 })
  eventId: string;

  @Column({ type: 'varchar', length: 32, default: DeliveryStatus.PENDING })
  status: DeliveryStatus;

  /** Incremented when a worker claims the job, so a crash still consumes an attempt. */
  @Column({ type: 'int', default: 0 })
  attemptCount: number;

  @Column({ type: 'datetime', precision: TIMESTAMP_PRECISION })
  nextAttemptAt: Date;

  /** Set when claimed; a stale value means the owning worker died. */
  @Column({ type: 'datetime', precision: TIMESTAMP_PRECISION, nullable: true })
  lockedAt: Date | null;

  /** Which worker holds the lease. Diagnostic only; correctness comes from the conditional UPDATE. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  lockedBy: string | null;

  @CreateDateColumn({ type: 'datetime', precision: TIMESTAMP_PRECISION })
  createdAt: Date;

  @UpdateDateColumn({ type: 'datetime', precision: TIMESTAMP_PRECISION })
  updatedAt: Date;
}
