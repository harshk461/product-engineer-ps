import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { WebhookClient } from '../../src/delivery/webhook.client';
import { DeliveryWorker } from '../../src/delivery/delivery.worker';
import { DeliveryRepository } from '../../src/delivery/delivery.repository';
import { DeliveryService } from '../../src/delivery/delivery.service';
import { EventsService } from '../../src/events/events.service';
import { AttemptsService } from '../../src/attempts/attempts.service';
import { DashboardService } from '../../src/dashboard/dashboard.service';
import { RealtimeGateway } from '../../src/realtime/realtime.gateway';
import { TestReceiverService } from '../../src/test-receiver/test-receiver.service';
import { MetricsService } from '../../src/metrics/metrics.service';
import { FakeWebhookClient } from './fake-webhook.client';
import { RealtimeEvent } from '../../src/common/realtime-event';
import { createServer } from 'node:net';

export interface TestContext {
  app: INestApplication;
  baseUrl: string;
  moduleRef: TestingModule;
  dataSource: DataSource;
  webhook: FakeWebhookClient;
  worker: DeliveryWorker;
  deliveryRepository: DeliveryRepository;
  delivery: DeliveryService;
  events: EventsService;
  attempts: AttemptsService;
  dashboard: DashboardService;
  receiver: TestReceiverService;
  metrics: MetricsService;
  /** Everything the gateway published, in order. */
  published: RealtimeEvent[];
  close: () => Promise<void>;
}

export interface TestAppOptions {
  env?: Record<string, string>;
  /** Use the real HTTP client instead of the scripted fake. */
  realWebhookClient?: boolean;
}

/**
 * Boots the whole application against a fresh in-memory database.
 *
 * Nothing is mocked except the HTTP transport: the same modules, repositories,
 * state machine and worker the production app uses are under test.
 */
export async function createTestApp(options: TestAppOptions = {}): Promise<TestContext> {
  const originalEnv = { ...process.env };
  Object.assign(process.env, options.env ?? {});

  const webhook = new FakeWebhookClient();
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (!options.realWebhookClient) {
    builder = builder.overrideProvider(WebhookClient).useValue(webhook);
  }

  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  // Listening for real (on an ephemeral port unless one was requested) keeps
  // concurrent supertest requests on a single server, and lets the end-to-end
  // test deliver over actual HTTP to the bundled test receiver.
  await app.listen(Number(process.env.PORT ?? 0));

  // Capture realtime traffic without a socket server: the gateway publishes to
  // an in-process stream, which is also what the dashboard stats feed uses.
  const gateway = moduleRef.get(RealtimeGateway);
  const published: RealtimeEvent[] = [];
  const subscription = gateway.activity$.subscribe((event) => published.push(event));

  return {
    app,
    baseUrl: await app.getUrl(),
    moduleRef,
    dataSource: moduleRef.get(DataSource),
    webhook,
    worker: moduleRef.get(DeliveryWorker),
    deliveryRepository: moduleRef.get(DeliveryRepository),
    delivery: moduleRef.get(DeliveryService),
    events: moduleRef.get(EventsService),
    attempts: moduleRef.get(AttemptsService),
    dashboard: moduleRef.get(DashboardService),
    receiver: moduleRef.get(TestReceiverService),
    metrics: moduleRef.get(MetricsService),
    published,
    close: async () => {
      subscription.unsubscribe();
      await app.close();
      process.env = originalEnv;
    },
  };
}

export function eventPayload(eventId: string, overrides: Record<string, unknown> = {}) {
  return {
    eventId,
    type: 'incident.created',
    occurredAt: '2026-09-15T10:00:00.000Z',
    payload: { incidentId: 'inc_456', severity: 'high' },
    ...overrides,
  };
}

/** Run worker ticks until nothing is left to claim, with a hard bound. */
export async function drain(worker: DeliveryWorker, maxTicks = 10): Promise<number> {
  let ticks = 0;
  for (let i = 0; i < maxTicks; i += 1) {
    const result = await worker.runOnce();
    ticks += 1;
    if (result.claimed === 0 && result.recovered === 0) break;
  }
  return ticks;
}

/** Reserve a free TCP port so WEBHOOK_TARGET_URL can be built before boot. */
export async function reserveFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}
