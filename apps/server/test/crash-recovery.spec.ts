import request from 'supertest';
import { createTestApp, drain, eventPayload, TestContext } from './helpers/test-app';
import { DeliveryStatus } from '../src/common/delivery-status.enum';
import { AttemptStatus, DeliveryErrorType } from '../src/common/attempt.enums';
import { DeliveryJob } from '../src/delivery/entities/delivery-job.entity';
import { RealtimeEventType } from '../src/common/realtime-event';

/**
 * A crashed worker leaves a job stuck in DELIVERING with a stale lease. These
 * tests simulate that exactly as it appears in the database, because that is
 * all a restarted process ever sees.
 */
describe('crash recovery', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestApp({ env: { WORKER_LEASE_TIMEOUT_MS: '30000' } });
  });

  afterEach(async () => {
    await ctx.close();
  });

  const jobs = () => ctx.dataSource.getRepository(DeliveryJob);

  async function simulateCrashMidAttempt(eventId: string, lockedMsAgo: number) {
    await request(ctx.app.getHttpServer()).post('/events').send(eventPayload(eventId)).expect(202);

    // What the worker does before the HTTP call: claim the job, open an attempt.
    const claimed = await ctx.deliveryRepository.claim(
      (await ctx.deliveryRepository.findByEventId(eventId))!.id,
      'worker-that-dies',
    );
    await ctx.attempts.start(eventId, claimed!.attemptCount);

    // ...and then the process disappears, leaving the lease behind.
    await jobs().update(claimed!.id, { lockedAt: new Date(Date.now() - lockedMsAgo) });
    return claimed!;
  }

  it('leaves work in the database when the process dies mid-delivery', async () => {
    await simulateCrashMidAttempt('evt_crash', 60_000);

    const job = await ctx.deliveryRepository.findByEventId('evt_crash');
    expect(job).toMatchObject({ status: DeliveryStatus.DELIVERING, attemptCount: 1 });
  });

  it('requeues a job whose lease expired and finishes the delivery', async () => {
    ctx.webhook.alwaysRespondWith({ status: 200 });
    await simulateCrashMidAttempt('evt_crash_recovered', 60_000);

    // Recovery is asserted on its own: with zero configured backoff the worker
    // would otherwise recover and redeliver within the same tick.
    expect(await ctx.delivery.recoverStaleJobs(10)).toBe(1);

    const requeued = await ctx.deliveryRepository.findByEventId('evt_crash_recovered');
    expect(requeued).toMatchObject({ status: DeliveryStatus.RETRYING, attemptCount: 1 });
    expect(requeued!.lockedAt).toBeNull();

    // The abandoned attempt is closed out rather than left hanging forever.
    const abandoned = (await ctx.attempts.findByEventId('evt_crash_recovered'))[0];
    expect(abandoned).toMatchObject({
      status: AttemptStatus.FAILED,
      errorType: DeliveryErrorType.WORKER_CRASH,
    });
    expect(abandoned.completedAt).not.toBeNull();

    await drain(ctx.worker);
    expect((await ctx.events.findOne('evt_crash_recovered')).status).toBe(DeliveryStatus.DELIVERED);

    expect(ctx.published.some((e) => e.type === RealtimeEventType.DELIVERY_RECOVERED)).toBe(true);
  });

  it('does not touch a job whose lease is still valid', async () => {
    await simulateCrashMidAttempt('evt_still_working', 1_000);

    const result = await ctx.worker.runOnce();

    expect(result.recovered).toBe(0);
    expect((await ctx.deliveryRepository.findByEventId('evt_still_working'))!.status).toBe(
      DeliveryStatus.DELIVERING,
    );
  });

  it('keeps retries bounded across repeated crashes', async () => {
    ctx.webhook.alwaysRespondWith({ status: 200 });
    // Attempt 1 is consumed by the first crash.
    await simulateCrashMidAttempt('evt_repeated_crash', 60_000);

    // Crash again on attempts 2 and 3, before either can reach the receiver.
    for (const attemptNumber of [2, 3]) {
      expect(await ctx.delivery.recoverStaleJobs(10)).toBe(1);

      const job = await ctx.deliveryRepository.findByEventId('evt_repeated_crash');
      expect(job!.status).toBe(DeliveryStatus.RETRYING);

      const claimed = await ctx.deliveryRepository.claim(job!.id, 'worker-that-dies');
      expect(claimed!.attemptCount).toBe(attemptNumber);
      await ctx.attempts.start('evt_repeated_crash', claimed!.attemptCount);
      await jobs().update(claimed!.id, { lockedAt: new Date(Date.now() - 60_000) });
    }

    // The budget is spent, so recovery terminates the job instead of requeueing it.
    expect(await ctx.delivery.recoverStaleJobs(10)).toBe(1);

    const job = await ctx.deliveryRepository.findByEventId('evt_repeated_crash');
    expect(job!.attemptCount).toBe(3);
    expect(job!.status).toBe(DeliveryStatus.FAILED);
    // Bounded at MAX_ATTEMPTS even though no attempt ever reached the receiver.
    expect(ctx.webhook.callCount).toBe(0);
    expect(await ctx.deliveryRepository.findDueJobIds(10)).toHaveLength(0);
  });
});
