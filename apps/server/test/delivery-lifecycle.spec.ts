import request from 'supertest';
import { createTestApp, drain, eventPayload, TestContext } from './helpers/test-app';
import { DeliveryStatus } from '../src/common/delivery-status.enum';
import { AttemptStatus, DeliveryErrorType } from '../src/common/attempt.enums';
import { RealtimeEventType } from '../src/common/realtime-event';

describe('delivery lifecycle', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestApp();
  });

  afterEach(async () => {
    await ctx.close();
  });

  const submit = (eventId: string) =>
    request(ctx.app.getHttpServer()).post('/events').send(eventPayload(eventId)).expect(202);

  const statusOf = async (eventId: string) => (await ctx.events.findOne(eventId)).status;

  it('delivers on the first attempt when the receiver answers 200', async () => {
    ctx.webhook.alwaysRespondWith({ status: 200 });
    await submit('evt_success');

    expect(await statusOf('evt_success')).toBe(DeliveryStatus.PENDING);

    await ctx.worker.runOnce();

    expect(await statusOf('evt_success')).toBe(DeliveryStatus.DELIVERED);
    expect(ctx.webhook.callCount).toBe(1);

    const attempts = await ctx.attempts.findByEventId('evt_success');
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      attemptNumber: 1,
      status: AttemptStatus.SUCCESS,
      httpStatus: 200,
    });
    expect(attempts[0].completedAt).not.toBeNull();
  });

  it('retries a 503 and delivers on the second attempt', async () => {
    ctx.webhook.respondWith({ status: 503 }, { status: 200 });
    await submit('evt_retry');

    await ctx.worker.runOnce();
    expect(await statusOf('evt_retry')).toBe(DeliveryStatus.RETRYING);

    const job = await ctx.deliveryRepository.findByEventId('evt_retry');
    expect(job).toMatchObject({ attemptCount: 1, status: DeliveryStatus.RETRYING });
    expect(job!.lockedAt).toBeNull();

    await ctx.worker.runOnce();

    expect(await statusOf('evt_retry')).toBe(DeliveryStatus.DELIVERED);
    const attempts = await ctx.attempts.findByEventId('evt_retry');
    expect(attempts.map((a) => [a.attemptNumber, a.status, a.httpStatus])).toEqual([
      [1, AttemptStatus.FAILED, 503],
      [2, AttemptStatus.SUCCESS, 200],
    ]);
  });

  it('stops after exactly MAX_ATTEMPTS when the receiver keeps failing', async () => {
    ctx.webhook.alwaysRespondWith({ status: 503 });
    await submit('evt_exhausted');

    await drain(ctx.worker);

    expect(await statusOf('evt_exhausted')).toBe(DeliveryStatus.FAILED);
    expect(ctx.webhook.callCount).toBe(3);

    const attempts = await ctx.attempts.findByEventId('evt_exhausted');
    expect(attempts).toHaveLength(3);
    expect(attempts.every((a) => a.status === AttemptStatus.FAILED && a.httpStatus === 503)).toBe(true);

    const exhausted = ctx.published.filter((e) => e.type === RealtimeEventType.DELIVERY_EXHAUSTED);
    expect(exhausted).toHaveLength(1);
    expect(exhausted[0]).toMatchObject({ attemptNumber: 3, nextAttemptAt: null });

    // Terminal means terminal: further ticks must not touch the job.
    await ctx.worker.runOnce();
    expect(ctx.webhook.callCount).toBe(3);
  });

  it('fails immediately on a permanent 400 without scheduling a retry', async () => {
    ctx.webhook.alwaysRespondWith({ status: 400 });
    await submit('evt_permanent');

    await drain(ctx.worker);

    expect(await statusOf('evt_permanent')).toBe(DeliveryStatus.FAILED);
    expect(ctx.webhook.callCount).toBe(1);

    const attempts = await ctx.attempts.findByEventId('evt_permanent');
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ httpStatus: 400, errorType: DeliveryErrorType.HTTP_ERROR });

    expect(ctx.published.some((e) => e.type === RealtimeEventType.DELIVERY_RETRY_SCHEDULED)).toBe(false);
    expect(ctx.published.some((e) => e.type === RealtimeEventType.DELIVERY_EXHAUSTED)).toBe(false);
  });

  it('retries transport failures that never reached the receiver', async () => {
    ctx.webhook.respondWith(
      { errorType: DeliveryErrorType.CONNECTION_REFUSED },
      { errorType: DeliveryErrorType.TIMEOUT },
      { status: 200 },
    );
    await submit('evt_network');

    await drain(ctx.worker);

    expect(await statusOf('evt_network')).toBe(DeliveryStatus.DELIVERED);
    const attempts = await ctx.attempts.findByEventId('evt_network');
    expect(attempts.map((a) => a.errorType)).toEqual([
      DeliveryErrorType.CONNECTION_REFUSED,
      DeliveryErrorType.TIMEOUT,
      null,
    ]);
  });

  it('exposes the attempt history over REST', async () => {
    ctx.webhook.respondWith({ status: 503 }, { status: 200 });
    await submit('evt_history');
    await drain(ctx.worker);

    const response = await request(ctx.app.getHttpServer())
      .get('/events/evt_history/attempts')
      .expect(200);

    expect(response.body.eventId).toBe('evt_history');
    expect(response.body.attempts).toHaveLength(2);
    expect(response.body.attempts[0].httpStatus).toBe(503);
    expect(response.body.attempts[1].httpStatus).toBe(200);
  });

  it('reports the last error and next attempt time in the event list', async () => {
    ctx.webhook.alwaysRespondWith({ status: 503 });
    await submit('evt_listing');
    await ctx.worker.runOnce();

    const response = await request(ctx.app.getHttpServer()).get('/events').expect(200);
    const item = response.body.items.find((e: { eventId: string }) => e.eventId === 'evt_listing');

    expect(item).toMatchObject({
      status: DeliveryStatus.RETRYING,
      attemptCount: 1,
      maxAttempts: 3,
    });
    expect(item.lastError.httpStatus).toBe(503);
    expect(item.nextAttemptAt).not.toBeNull();
  });
});
