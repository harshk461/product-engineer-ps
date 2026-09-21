import { Controller, Get } from '@nestjs/common';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  /** Authoritative aggregate state; the dashboard calls this on load and on reconnect. */
  @Get('stats')
  getStats() {
    return this.dashboardService.getStats();
  }
}
