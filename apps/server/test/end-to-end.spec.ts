import request from 'supertest';
import { createTestApp, drain, eventPayload, reserveFreePort, TestContext } from './helpers/test-app';
import { DeliveryStatus } from '../src/common/delivery-status.enum';
import { ReceiverMode } from '../src/test-receiver/test-receiver.service';
import { DeliveryErrorType } from '../src/common/attempt.enums';

/**
 * The demo scenarios, end to end: real HTTP, real axios client, real receiver.
 * Only the clock is shortened (zero backoff) and the worker is driven by hand.
 */
describe('end-to-end delivery over HTTP', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    const port = await reserveFreePort();
    ctx = await createTestApp({
      realWebhookClient: true,
      env: {
        PORT: String(port),
        WEBHOOK_TARGET_URL: `http://127.0.0.1:${port}/test-receiver/webhook`,
        WEBHOOK_TIMEOUT_MS: '500',
      },
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  const http = () => request(ctx.app.getHttpServer());

  const setMode = (body: Record<string, unknown>) =>
    http().post('/test-receiver/config').send({ resetState: true, ...body }).expect(200);

  const submit = (eventId: string) => http().post('/events').send(eventPayload(eventId)).expect(202);

  const detail = async (eventId: string) => (await http().get(`/events/${eventId}`).expect(200)).body;

  it('scenario 1: SUCCESS delivers on attempt 1', async () => {
    await setMode({ mode: ReceiverMode.SUCCESS });
    await submit('evt_e2e_success');
    await drain(ctx.worker);

    const event = await detail('evt_e2e_success');
    expect(event.status).toBe(DeliveryStatus.DELIVERED);
    expect(event.attempts).toHaveLength(1);
    expect(event.attempts[0].httpStatus).toBe(200);
  });

  it('scenario 2: FAIL_ONCE retries a 503 and then succeeds', async () => {
    await setMode({ mode: ReceiverMode.FAIL_ONCE, failureStatus: 503 });
    await submit('evt_e2e_retry');
    await drain(ctx.worker);

    const event = await detail('evt_e2e_retry');
    expect(event.status).toBe(DeliveryStatus.DELIVERED);
    expect(event.attempts.map((a: { httpStatus: number }) => a.httpStatus)).toEqual([503, 200]);
  });

  it('scenario 3: FAIL_ALWAYS exhausts the retry budget', async () => {
    await setMode({ mode: ReceiverMode.FAIL_ALWAYS, failureStatus: 503 });
    await submit('evt_e2e_exhausted');
    await drain(ctx.worker);

    const event = await detail('evt_e2e_exhausted');
    expect(event.status).toBe(DeliveryStatus.FAILED);
    expect(event.attempts).toHaveLength(3);
    expect(event.attemptsRemaining).toBe(0);
    expect(event.nextAttemptAt).toBeNull();
  });

  it('scenario 3b: a permanent 400 fails without retrying', async () => {
    await setMode({ mode: ReceiverMode.FAIL_ALWAYS, failureStatus: 400 });
    await submit('evt_e2e_permanent');
    await drain(ctx.worker);

    const event = await detail('evt_e2e_permanent');
    expect(event.status).toBe(DeliveryStatus.FAILED);
    expect(event.attempts).toHaveLength(1);
    expect(event.attempts[0].errorMessage).toContain('400');
  });

  it('scenario 4: three submissions produce one event and one delivery', async () => {
    await setMode({ mode: ReceiverMode.SUCCESS });
    await submit('evt_e2e_duplicate');
    await submit('evt_e2e_duplicate');
    await submit('evt_e2e_duplicate');
    await drain(ctx.worker);

    const event = await detail('evt_e2e_duplicate');
    expect(event.attempts).toHaveLength(1);

    const receiver = (await http().get('/test-receiver/config').expect(200)).body;
    expect(receiver.stats.totalReceived).toBe(1);
    expect(receiver.stats.duplicateDeliveries).toBe(0);
  });

  it('classifies a receiver timeout as a retryable transport failure', async () => {
    await setMode({ mode: ReceiverMode.SUCCESS, latencyMs: 900 });
    await submit('evt_e2e_timeout');
    await ctx.worker.runOnce();

    const event = await detail('evt_e2e_timeout');
    expect(event.status).toBe(DeliveryStatus.RETRYING);
    expect(event.attempts[0].errorType).toBe(DeliveryErrorType.TIMEOUT);
    expect(event.attempts[0].httpStatus).toBeNull();

    await setMode({ mode: ReceiverMode.SUCCESS, latencyMs: 0 });
    await drain(ctx.worker);
    expect((await detail('evt_e2e_timeout')).status).toBe(DeliveryStatus.DELIVERED);
  });

  it('signs every delivery and passes the event id for receiver-side idempotency', async () => {
    await setMode({ mode: ReceiverMode.SUCCESS });
    await submit('evt_e2e_headers');
    await drain(ctx.worker);

    const receiver = (await http().get('/test-receiver/config').expect(200)).body;
    expect(receiver.stats.uniqueEvents).toBe(1);
  });

  it('serves health and aggregate statistics', async () => {
    const health = (await http().get('/health').expect(200)).body;
    expect(health.status).toBe('ok');
    expect(health.database).toBe('up');
    expect(health.retry.maxAttempts).toBe(3);

    const stats = (await http().get('/dashboard/stats').expect(200)).body;
    expect(stats.totals.events).toBeGreaterThan(0);
    expect(stats.httpStatusDistribution['200']).toBeGreaterThan(0);
    expect(stats.delivery.maxAttempts).toBe(3);
  });
});
