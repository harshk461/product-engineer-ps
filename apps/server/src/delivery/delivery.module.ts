import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeliveryJob } from './entities/delivery-job.entity';
import { EventEntity } from '../events/entities/event.entity';
import { DeliveryRepository } from './delivery.repository';
import { DeliveryService } from './delivery.service';
import { DeliveryWorker } from './delivery.worker';
import { WebhookClient } from './webhook.client';
import { RetryPolicy } from './retry-policy';
import { AttemptsModule } from '../attempts/attempts.module';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([DeliveryJob, EventEntity]),
    HttpModule.register({ maxRedirects: 0 }),
    AttemptsModule,
    RealtimeModule,
  ],
  providers: [DeliveryRepository, DeliveryService, DeliveryWorker, WebhookClient, RetryPolicy],
  exports: [DeliveryRepository, DeliveryService, DeliveryWorker, RetryPolicy],
})
export class DeliveryModule {}
