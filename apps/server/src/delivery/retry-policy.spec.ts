import { classifyHttpStatus, classifyResult, RetryPolicy } from './retry-policy';
import { DeliveryErrorType, FailureClassification } from '../common/attempt.enums';
import { AppConfigService } from '../config/app-config.service';

describe('retry classification', () => {
  it.each([200, 201, 202, 204])('treats %s as success', (status) => {
    expect(classifyHttpStatus(status)).toBe('SUCCESS');
  });

  it.each([408, 429, 500, 502, 503, 504])('retries %s', (status) => {
    expect(classifyHttpStatus(status)).toBe(FailureClassification.RETRYABLE);
  });

  it.each([400, 401, 403, 404, 405, 422])('never retries %s', (status) => {
    expect(classifyHttpStatus(status)).toBe(FailureClassification.PERMANENT);
  });

  it.each([
    DeliveryErrorType.TIMEOUT,
    DeliveryErrorType.CONNECTION_REFUSED,
    DeliveryErrorType.DNS_ERROR,
    DeliveryErrorType.NETWORK_ERROR,
  ])('retries transport failure %s', (errorType) => {
    expect(
      classifyResult({ responded: false, httpStatus: null, errorType, errorMessage: 'x', durationMs: 1 }),
    ).toBe(FailureClassification.RETRYABLE);
  });
});

describe('RetryPolicy', () => {
  const policy = (maxAttempts: number, delaysMs: number[]) =>
    new RetryPolicy({ retry: { maxAttempts, delaysMs } } as AppConfigService);

  it('applies the configured backoff between attempts', () => {
    const retry = policy(3, [300_000, 1_800_000]);
    const from = new Date('2026-09-15T10:00:00.000Z');

    expect(retry.nextAttemptAt(1, from).toISOString()).toBe('2026-09-15T10:05:00.000Z');
    expect(retry.nextAttemptAt(2, from).toISOString()).toBe('2026-09-15T10:30:00.000Z');
  });

  it('knows when the attempt budget is spent', () => {
    const retry = policy(3, [0, 0]);

    expect(retry.isExhausted(2)).toBe(false);
    expect(retry.attemptsRemaining(2)).toBe(1);
    expect(retry.isExhausted(3)).toBe(true);
    expect(retry.attemptsRemaining(3)).toBe(0);
  });

  it('reuses the final delay when more attempts than delays are configured', () => {
    const retry = policy(5, [1_000, 2_000]);

    expect(retry.delayAfterAttemptMs(3)).toBe(2_000);
    expect(retry.delayAfterAttemptMs(4)).toBe(2_000);
  });
});
