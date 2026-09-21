import { Body, Controller, Get, Headers, HttpCode, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { TestReceiverService } from './test-receiver.service';
import { UpdateReceiverConfigDto } from './dto/update-receiver-config.dto';

@Controller('test-receiver')
export class TestReceiverController {
  constructor(private readonly receiver: TestReceiverService) {}

  /**
   * The webhook endpoint the engine delivers to by default.
   *
   * Responds with the configured status directly instead of throwing, so the
   * engine sees an ordinary HTTP response and classifies it the same way it
   * would classify any third-party receiver.
   */
  @Post('webhook')
  async receive(
    @Headers('x-webhook-event-id') eventId: string | undefined,
    @Headers('x-webhook-attempt') attempt: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const decision = await this.receiver.handleDelivery(eventId, attempt);
    res.status(decision.status).json(decision.body);
  }

  @Get('config')
  getConfig() {
    return { config: this.receiver.getConfig(), stats: this.receiver.getStats() };
  }

  @Post('config')
  @HttpCode(200)
  updateConfig(@Body() dto: UpdateReceiverConfigDto) {
    const config = this.receiver.updateConfig(dto);
    return { config, stats: this.receiver.getStats() };
  }
}
