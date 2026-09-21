import request from 'supertest';
import { createTestApp, eventPayload, TestContext } from './helpers/test-app';
import { DeliveryStatus } from '../src/common/delivery-status.enum';

/**
 * Job claiming must be safe for more than one worker. The claim is a single
 * conditional UPDATE, so these tests assert the property that makes it safe:
 * exactly one caller can observe a successful claim for a given job.
 */
describe('job claiming', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestApp();
  });

  afterEach(async () => {
    await ctx.close();
  });

  const submit = (eventId: string) =>
    request(ctx.app.getHttpServer()).post('/events').send(eventPayload(eventId)).expect(202);

  it('lets exactly one worker claim a job', async () => {
    await submit('evt_claim');
    const job = await ctx.deliveryRepository.findByEventId('evt_claim');

    const claims = await Promise.all([
      ctx.deliveryRepository.claim(job!.id, 'worker-a'),
      ctx.deliveryRepository.claim(job!.id, 'worker-b'),
      ctx.deliveryRepository.claim(job!.id, 'worker-c'),
    ]);

    expect(claims.filter(Boolean)).toHaveLength(1);
    const claimed = await ctx.deliveryRepository.findByEventId('evt_claim');
    // One claim means one consumed attempt, whoever won.
    expect(claimed).toMatchObject({ status: DeliveryStatus.DELIVERING, attemptCount: 1 });
    expect(['worker-a', 'worker-b', 'worker-c']).toContain(claimed!.lockedBy);
  });

  it('refuses to claim a job scheduled for the future', async () => {
    await submit('evt_future');
    const job = await ctx.deliveryRepository.findByEventId('evt_future');
    await ctx.deliveryRepository.scheduleRetry(job!, new Date(Date.now() + 60_000));

    expect(await ctx.deliveryRepository.findDueJobIds(10)).not.toContain(job!.id);
    expect(await ctx.deliveryRepository.claim(job!.id, 'worker-a')).toBeNull();
  });

  it('refuses to claim a job in a terminal state', async () => {
    await submit('evt_terminal');
    const job = await ctx.deliveryRepository.findByEventId('evt_terminal');
    await ctx.deliveryRepository.markDelivered(job!);

    expect(await ctx.deliveryRepository.claim(job!.id, 'worker-a')).toBeNull();
    expect(await ctx.deliveryRepository.findDueJobIds(10)).toHaveLength(0);
  });

  it('processes a backlog of due jobs in one tick', async () => {
    ctx.webhook.alwaysRespondWith({ status: 200 });
    await Promise.all(['evt_a', 'evt_b', 'evt_c'].map(submit));

    const result = await ctx.worker.runOnce();

    expect(result).toMatchObject({ claimed: 3, processed: 3 });
    expect(ctx.webhook.callCount).toBe(3);
  });
});
