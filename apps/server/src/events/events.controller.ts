import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { CreateEventDto } from './dto/create-event.dto';
import { ListEventsQueryDto } from './dto/list-events.query.dto';
import { EventsService } from './events.service';

@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  /**
   * Accepts an event for delivery.
   *
   * Always 202: a duplicate submission is a successful no-op, distinguished by
   * the `duplicate` flag rather than by an error status, because the caller did
   * nothing wrong and retrying is exactly what an at-least-once producer does.
   */
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async create(@Body() dto: CreateEventDto) {
    const { duplicate, event } = await this.eventsService.ingest(dto);
    return {
      accepted: true,
      duplicate,
      eventId: event.eventId,
      status: event.status,
      message: duplicate
        ? 'Event already exists; the original event and its delivery job were kept unchanged'
        : 'Event accepted and delivery scheduled',
    };
  }

  @Get()
  list(@Query() query: ListEventsQueryDto) {
    return this.eventsService.list(query);
  }

  @Get(':eventId')
  findOne(@Param('eventId') eventId: string) {
    return this.eventsService.findOne(eventId);
  }

  @Get(':eventId/attempts')
  async findAttempts(@Param('eventId') eventId: string) {
    const attempts = await this.eventsService.findAttempts(eventId);
    return { eventId, attempts };
  }
}
