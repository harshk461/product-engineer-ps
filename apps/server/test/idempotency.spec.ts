import request from 'supertest';
import { createTestApp, eventPayload, TestContext } from './helpers/test-app';
import { EventEntity } from '../src/events/entities/event.entity';
import { DeliveryJob } from '../src/delivery/entities/delivery-job.entity';
import { RealtimeEventType } from '../src/common/realtime-event';
import { MetricsService } from '../src/metrics/metrics.service';

describe('idempotent ingestion', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestApp();
  });

  afterEach(async () => {
    await ctx.close();
  });

  const countEvents = () => ctx.dataSource.getRepository(EventEntity).count();
  const countJobs = () => ctx.dataSource.getRepository(DeliveryJob).count();

  it('collapses repeated submissions into one event and one delivery job', async () => {
    for (let i = 0; i < 3; i += 1) {
      const response = await request(ctx.app.getHttpServer())
        .post('/events')
        .send(eventPayload('evt_123'))
        .expect(202);
      expect(response.body.duplicate).toBe(i > 0);
    }

    expect(await countEvents()).toBe(1);
    expect(await countJobs()).toBe(1);
    expect(ctx.metrics.counter(MetricsService.EVENTS_ACCEPTED)).toBe(1);
    expect(ctx.metrics.counter(MetricsService.EVENTS_DUPLICATE)).toBe(2);

    const duplicates = ctx.published.filter((e) => e.type === RealtimeEventType.DUPLICATE_EVENT);
    expect(duplicates).toHaveLength(2);
  });

  it('keeps one event and one job when submissions overlap', async () => {
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(ctx.app.getHttpServer()).post('/events').send(eventPayload('evt_concurrent')),
      ),
    );

    expect(responses.every((r) => r.status === 202)).toBe(true);
    expect(responses.filter((r) => r.body.duplicate === false)).toHaveLength(1);
    expect(responses.filter((r) => r.body.duplicate === true)).toHaveLength(4);

    expect(await countEvents()).toBe(1);
    expect(await countJobs()).toBe(1);
  });

  it('never lets a later submission overwrite the first accepted payload', async () => {
    await request(ctx.app.getHttpServer())
      .post('/events')
      .send(eventPayload('evt_immutable', { payload: { severity: 'high' } }))
      .expect(202);

    await request(ctx.app.getHttpServer())
      .post('/events')
      .send(
        eventPayload('evt_immutable', {
          type: 'incident.resolved',
          payload: { severity: 'low', tampered: true },
        }),
      )
      .expect(202);

    const stored = await ctx.events.findOne('evt_immutable');
    expect(stored.type).toBe('incident.created');
    expect(stored.payload).toEqual({ severity: 'high' });
  });

  it('delivers a duplicated event exactly once', async () => {
    ctx.webhook.alwaysRespondWith({ status: 200 });
    await request(ctx.app.getHttpServer()).post('/events').send(eventPayload('evt_once')).expect(202);
    await request(ctx.app.getHttpServer()).post('/events').send(eventPayload('evt_once')).expect(202);

    await ctx.worker.runOnce();
    await ctx.worker.runOnce();

    expect(ctx.webhook.callCount).toBe(1);
    expect(await ctx.attempts.findByEventId('evt_once')).toHaveLength(1);
  });

  it('rejects malformed submissions before anything is written', async () => {
    await request(ctx.app.getHttpServer())
      .post('/events')
      .send({ type: 'incident.created', occurredAt: '2026-09-15T10:00:00Z', payload: {} })
      .expect(400);

    await request(ctx.app.getHttpServer())
      .post('/events')
      .send(eventPayload('evt_bad_date', { occurredAt: 'not-a-date' }))
      .expect(400);

    expect(await countEvents()).toBe(0);
    expect(await countJobs()).toBe(0);
  });
});
