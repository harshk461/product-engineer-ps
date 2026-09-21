import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, FindOptionsWhere, In, Like, Repository } from 'typeorm';
import { EventEntity } from './entities/event.entity';
import { DeliveryStatus } from '../common/delivery-status.enum';

export interface ListEventsOptions {
  status?: DeliveryStatus;
  search?: string;
  limit: number;
  offset: number;
}

@Injectable()
export class EventsRepository {
  constructor(
    @InjectRepository(EventEntity)
    private readonly events: Repository<EventEntity>,
  ) {}

  async insert(
    manager: EntityManager,
    event: Pick<EventEntity, 'eventId' | 'type' | 'occurredAt' | 'payload'>,
  ): Promise<EventEntity> {
    const entity = manager.create(EventEntity, { ...event, status: DeliveryStatus.PENDING });
    return manager.save(EventEntity, entity);
  }

  findByEventId(eventId: string): Promise<EventEntity | null> {
    return this.events.findOne({ where: { eventId } });
  }

  findManyByEventIds(eventIds: string[]): Promise<EventEntity[]> {
    if (eventIds.length === 0) return Promise.resolve([]);
    return this.events.find({ where: { eventId: In(eventIds) } });
  }

  async list(options: ListEventsOptions): Promise<{ items: EventEntity[]; total: number }> {
    const where: FindOptionsWhere<EventEntity>[] = [];
    const base: FindOptionsWhere<EventEntity> = {};
    if (options.status) base.status = options.status;

    if (options.search) {
      where.push({ ...base, eventId: Like(`%${options.search}%`) });
      where.push({ ...base, type: Like(`%${options.search}%`) });
    } else {
      where.push(base);
    }

    const [items, total] = await this.events.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      take: options.limit,
      skip: options.offset,
    });
    return { items, total };
  }

  countByStatus(): Promise<Array<{ status: DeliveryStatus; count: string }>> {
    return this.events
      .createQueryBuilder('event')
      .select('event.status', 'status')
      .addSelect('COUNT(1)', 'count')
      .groupBy('event.status')
      .getRawMany();
  }

  count(): Promise<number> {
    return this.events.count();
  }

  /** Delivered events with their ingestion timestamp, for latency statistics. */
  findRecentDelivered(limit: number): Promise<EventEntity[]> {
    return this.events.find({
      where: { status: DeliveryStatus.DELIVERED },
      order: { updatedAt: 'DESC' },
      take: limit,
    });
  }
}
