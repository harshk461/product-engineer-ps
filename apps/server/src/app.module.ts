import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { MetricsModule } from './metrics/metrics.module';
import { RealtimeModule } from './realtime/realtime.module';
import { AttemptsModule } from './attempts/attempts.module';
import { DeliveryModule } from './delivery/delivery.module';
import { EventsModule } from './events/events.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { TestReceiverModule } from './test-receiver/test-receiver.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    MetricsModule,
    RealtimeModule,
    AttemptsModule,
    DeliveryModule,
    EventsModule,
    DashboardModule,
    TestReceiverModule,
    HealthModule,
  ],
})
export class AppModule {}
