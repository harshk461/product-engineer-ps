import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { EventEntity } from '../events/entities/event.entity';
import { DeliveryAttempt } from '../attempts/entities/delivery-attempt.entity';
import { RealtimeModule } from '../realtime/realtime.module';
import { DeliveryModule } from '../delivery/delivery.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([EventEntity, DeliveryAttempt]),
    RealtimeModule,
    DeliveryModule,
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
