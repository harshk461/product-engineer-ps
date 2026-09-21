import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { DeliveryModule } from '../delivery/delivery.module';

@Module({
  imports: [DeliveryModule],
  controllers: [HealthController],
})
export class HealthModule {}
