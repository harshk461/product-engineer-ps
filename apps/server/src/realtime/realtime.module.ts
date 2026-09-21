import { Module } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimePublisher } from './realtime.publisher';

@Module({
  providers: [RealtimeGateway, RealtimePublisher],
  exports: [RealtimeGateway, RealtimePublisher],
})
export class RealtimeModule {}
