import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventEntity } from './entities/event.entity';
import { EventsController } from './events.controller';
import { EventsRepository } from './events.repository';
import { EventsService } from './events.service';
import { DeliveryModule } from '../delivery/delivery.module';
import { AttemptsModule } from '../attempts/attempts.module';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([EventEntity]),
    DeliveryModule,
    AttemptsModule,
    RealtimeModule,
  ],
  controllers: [EventsController],
  providers: [EventsService, EventsRepository],
  exports: [EventsService, EventsRepository],
})
export class EventsModule {}
