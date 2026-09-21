import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeliveryAttempt } from './entities/delivery-attempt.entity';
import { AttemptsService } from './attempts.service';

@Module({
  imports: [TypeOrmModule.forFeature([DeliveryAttempt])],
  providers: [AttemptsService],
  exports: [AttemptsService, TypeOrmModule],
})
export class AttemptsModule {}
