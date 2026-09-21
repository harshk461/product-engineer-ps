import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DeliveryStatus } from '../../common/delivery-status.enum';
import { JSON_COLUMN_TYPE, TIMESTAMP_PRECISION } from '../../database/column-types';

/**
 * An ingested event. `eventId` is the caller-supplied idempotency key and is
 * protected by a UNIQUE constraint -- the database, not the application, is
 * what makes duplicate ingestion safe.
 *
 * `status` mirrors the delivery job's status so the event list can be rendered
 * from one table. The delivery job remains the authority; this is a projection
 * written inside the same transaction as the job update.
 */
@Entity('events')
@Index('idx_events_status', ['status'])
@Index('idx_events_created_at', ['createdAt'])
export class EventEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('uq_events_event_id', { unique: true })
  @Column({ type: 'varchar', length: 128 })
  eventId: string;

  @Column({ type: 'varchar', length: 128 })
  type: string;

  @Column({ type: 'datetime', precision: TIMESTAMP_PRECISION })
  occurredAt: Date;

  @Column({ type: JSON_COLUMN_TYPE })
  payload: Record<string, unknown>;

  @Column({ type: 'varchar', length: 32, default: DeliveryStatus.PENDING })
  status: DeliveryStatus;

  @CreateDateColumn({ type: 'datetime', precision: TIMESTAMP_PRECISION })
  createdAt: Date;

  @UpdateDateColumn({ type: 'datetime', precision: TIMESTAMP_PRECISION })
  updatedAt: Date;
}
