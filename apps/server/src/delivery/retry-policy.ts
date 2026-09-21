import { Injectable } from '@nestjs/common';
import { FailureClassification } from '../common/attempt.enums';
import { AppConfigService } from '../config/app-config.service';
import { WebhookDeliveryResult } from './webhook.client';

export type AttemptOutcome = 'SUCCESS' | FailureClassification;

/**
 * Retryable HTTP statuses.
 *
 * 408 and 429 are the two 4xx codes that mean "try again later"; every other
 * 4xx describes a request the receiver will reject identically forever, so
 * retrying it only burns attempts. All 5xx are treated as retryable.
 */
const RETRYABLE_CLIENT_STATUSES = new Set([408, 429]);

export function classifyHttpStatus(status: number): AttemptOutcome {
  if (status >= 200 && status < 300) return 'SUCCESS';
  if (RETRYABLE_CLIENT_STATUSES.has(status)) return FailureClassification.RETRYABLE;
  if (status >= 500) return FailureClassification.RETRYABLE;
  return FailureClassification.PERMANENT;
}

/**
 * Transport failures (timeout, connection refused, DNS, reset) never reached a
 * decision from the receiver, so they are always worth another attempt.
 */
export function classifyResult(result: WebhookDeliveryResult): AttemptOutcome {
  if (!result.responded || result.httpStatus === null) return FailureClassification.RETRYABLE;
  return classifyHttpStatus(result.httpStatus);
}

@Injectable()
export class RetryPolicy {
  constructor(private readonly config: AppConfigService) {}

  get maxAttempts(): number {
    return this.config.retry.maxAttempts;
  }

  classify(result: WebhookDeliveryResult): AttemptOutcome {
    return classifyResult(result);
  }

  /** True when the attempt that just finished was the last one allowed. */
  isExhausted(attemptNumber: number): boolean {
    return attemptNumber >= this.maxAttempts;
  }

  attemptsRemaining(attemptNumber: number): number {
    return Math.max(0, this.maxAttempts - attemptNumber);
  }

  /** Backoff to wait after `attemptNumber` failed (1-based). */
  delayAfterAttemptMs(attemptNumber: number): number {
    const delays = this.config.retry.delaysMs;
    if (delays.length === 0) return 0;
    return delays[Math.min(attemptNumber - 1, delays.length - 1)] ?? 0;
  }

  nextAttemptAt(attemptNumber: number, from: Date = new Date()): Date {
    return new Date(from.getTime() + this.delayAfterAttemptMs(attemptNumber));
  }
}
