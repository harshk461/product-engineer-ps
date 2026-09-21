import { Controller, Get } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DeliveryWorker } from '../delivery/delivery.worker';
import { AppConfigService } from '../config/app-config.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly worker: DeliveryWorker,
    private readonly config: AppConfigService,
  ) {}

  @Get()
  async check() {
    const database = await this.pingDatabase();
    return {
      status: database === 'up' ? 'ok' : 'degraded',
      database,
      worker: this.worker.status,
      retry: this.config.retry,
      target: this.config.webhook.targetUrl,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  private async pingDatabase(): Promise<'up' | 'down'> {
    try {
      await this.dataSource.query('SELECT 1');
      return 'up';
    } catch {
      return 'down';
    }
  }
}
