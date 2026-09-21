import request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { createTestApp, drain, eventPayload, TestContext } from './helpers/test-app';
import { REALTIME_ACTIVITY_CHANNEL, RealtimeEvent, RealtimeEventType } from '../src/common/realtime-event';
import { DeliveryStatus } from '../src/common/delivery-status.enum';

describe('real-time observability', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestApp();
  });

  afterEach(async () => {
    await ctx.close();
  });

  const submit = (eventId: string) =>
    request(ctx.app.getHttpServer()).post('/events').send(eventPayload(eventId)).expect(202);

  const typesFor = (eventId: string) =>
    ctx.published.filter((e) => e.eventId === eventId).map((e) => e.type);

  it('emits one event per state transition for a retried delivery', async () => {
    ctx.webhook.respondWith({ status: 503 }, { status: 200 });
    await submit('evt_rt_retry');
    await drain(ctx.worker);

    expect(typesFor('evt_rt_retry')).toEqual([
      RealtimeEventType.EVENT_ACCEPTED,
      RealtimeEventType.DELIVERY_STARTED,
      RealtimeEventType.DELIVERY_FAILED,
      RealtimeEventType.DELIVERY_RETRY_SCHEDULED,
      RealtimeEventType.DELIVERY_STARTED,
      RealtimeEventType.DELIVERY_SUCCEEDED,
    ]);
  });

  it('carries everything the dashboard needs to update a row', async () => {
    ctx.webhook.respondWith({ status: 503 }, { status: 200 });
    await submit('evt_rt_payload');
    await ctx.worker.runOnce();

    const scheduled = ctx.published.find(
      (e) => e.type === RealtimeEventType.DELIVERY_RETRY_SCHEDULED,
    ) as RealtimeEvent;

    expect(scheduled).toMatchObject({
      eventId: 'evt_rt_payload',
      status: DeliveryStatus.RETRYING,
      attemptNumber: 1,
      maxAttempts: 3,
      httpStatus: 503,
      attemptsRemaining: 2,
    });
    expect(Date.parse(scheduled.nextAttemptAt!)).not.toBeNaN();
    expect(Date.parse(scheduled.emittedAt)).not.toBeNaN();
  });

  it('announces exhaustion and permanent failure differently', async () => {
    ctx.webhook.alwaysRespondWith({ status: 503 });
    await submit('evt_rt_exhausted');
    await drain(ctx.worker);

    ctx.webhook.alwaysRespondWith({ status: 400 });
    await submit('evt_rt_permanent');
    await drain(ctx.worker);

    expect(typesFor('evt_rt_exhausted')).toContain(RealtimeEventType.DELIVERY_EXHAUSTED);
    expect(typesFor('evt_rt_permanent')).not.toContain(RealtimeEventType.DELIVERY_EXHAUSTED);
    expect(typesFor('evt_rt_permanent')).toEqual([
      RealtimeEventType.EVENT_ACCEPTED,
      RealtimeEventType.DELIVERY_STARTED,
      RealtimeEventType.DELIVERY_FAILED,
    ]);
  });

  it('reports duplicate submissions on the activity stream', async () => {
    await submit('evt_rt_duplicate');
    await submit('evt_rt_duplicate');

    const duplicate = ctx.published.find((e) => e.type === RealtimeEventType.DUPLICATE_EVENT);
    expect(duplicate).toMatchObject({ eventId: 'evt_rt_duplicate', duplicate: true });
  });

  it('pushes transitions to a connected websocket client', async () => {
    const received: RealtimeEvent[] = [];
    const socket: Socket = io(`${ctx.baseUrl}/realtime`, {
      transports: ['websocket'],
      forceNew: true,
    });
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
    socket.on(REALTIME_ACTIVITY_CHANNEL, (event: RealtimeEvent) => received.push(event));

    ctx.webhook.alwaysRespondWith({ status: 200 });
    await submit('evt_socket');
    await drain(ctx.worker);

    await waitFor(() => received.some((e) => e.type === RealtimeEventType.DELIVERY_SUCCEEDED));
    socket.disconnect();

    expect(received.map((e) => e.type)).toEqual([
      RealtimeEventType.EVENT_ACCEPTED,
      RealtimeEventType.DELIVERY_STARTED,
      RealtimeEventType.DELIVERY_SUCCEEDED,
    ]);
  });

  it('keeps delivering while no dashboard is listening, and REST stays authoritative', async () => {
    ctx.webhook.respondWith({ status: 503 }, { status: 200 });
    await submit('evt_offline');

    // Nothing is subscribed: every emit during this window is dropped.
    await drain(ctx.worker);

    // A dashboard that reconnects now rebuilds the truth from REST.
    const detail = await request(ctx.app.getHttpServer()).get('/events/evt_offline').expect(200);
    expect(detail.body.status).toBe(DeliveryStatus.DELIVERED);
    expect(detail.body.attempts).toHaveLength(2);

    const stats = await request(ctx.app.getHttpServer()).get('/dashboard/stats').expect(200);
    expect(stats.body.totals.delivered).toBe(1);
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('Timed out waiting for websocket event');
}
