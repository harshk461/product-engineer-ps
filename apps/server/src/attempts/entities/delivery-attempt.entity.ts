import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { AttemptStatus, DeliveryErrorType } from '../../common/attempt.enums';
import { TIMESTAMP_PRECISION } from '../../database/column-types';

/**
 * One row per HTTP attempt, written before the request leaves and completed
 * when it returns. Attempt rows are immutable history once completed: nothing
 * in the system rewrites them.
 *
 * UNIQUE(eventId, attemptNumber) holds because the attempt counter is
 * incremented atomically when the job is claimed.
 */
@Entity('delivery_attempts')
@Index('idx_delivery_attempts_event_id', ['eventId'])
@Index('uq_delivery_attempts_event_attempt', ['eventId', 'attemptNumber'], { unique: true })
export class DeliveryAttempt {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 128 })
  eventId: string;

  @Column({ type: 'int' })
  attemptNumber: number;

  @Column({ type: 'datetime', precision: TIMESTAMP_PRECISION })
  startedAt: Date;

  @Column({ type: 'datetime', precision: TIMESTAMP_PRECISION, nullable: true })
  completedAt: Date | null;

  @Column({ type: 'varchar', length: 32 })
  status: AttemptStatus;

  @Column({ type: 'int', nullable: true })
  httpStatus: number | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  errorType: DeliveryErrorType | null;

  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  @CreateDateColumn({ type: 'datetime', precision: TIMESTAMP_PRECISION })
  createdAt: Date;
}
