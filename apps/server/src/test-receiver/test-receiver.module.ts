import { Module } from '@nestjs/common';
import { TestReceiverController } from './test-receiver.controller';
import { TestReceiverService } from './test-receiver.service';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [RealtimeModule],
  controllers: [TestReceiverController],
  providers: [TestReceiverService],
  exports: [TestReceiverService],
})
export class TestReceiverModule {}
