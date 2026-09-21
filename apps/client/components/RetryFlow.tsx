'use client';

import { formatClock, formatCountdown, secondsUntil } from '@/lib/format';
import { useNow } from '@/hooks/useNow';
import { STATUS_PRESENTATION } from '@/lib/status';
import type { DeliveryAttempt, EventDetail } from '@/types';

interface Node {
  title: string;
  detail: string;
  color: string;
  icon: string;
  pending?: boolean;
}

/**
 * The lifecycle of one event, drawn as the chain of states it actually went
 * through: each attempt, what the receiver said, and what that caused.
 *
 * The point is that the current status is never unexplained -- the reason an
 * event is retrying, delivered or failed is visible in the chain itself.
 */
export function RetryFlow({ event }: { event: EventDetail }) {
  const now = useNow();
  const nodes = buildNodes(event, now);

  return (
    <section className="card" aria-label="Delivery lifecycle">
      <header className="card-header">
        <h2 className="card-title">Delivery lifecycle</h2>
        <span className="text-xs text-muted">
          {event.attemptCount} of {event.maxAttempts} attempts used
        </span>
      </header>

      <ol className="flex flex-wrap items-stretch gap-2 px-4 py-4">
        {nodes.map((node, index) => (
          <li key={`${node.title}-${index}`} className="flex items-stretch gap-2">
            <div
              className="min-w-[10rem] rounded-lg border px-3 py-2"
              style={{
                borderColor: `color-mix(in srgb, ${node.color} 45%, transparent)`,
                background: `color-mix(in srgb, ${node.color} 10%, transparent)`,
                borderStyle: node.pending ? 'dashed' : 'solid',
              }}
            >
              <div className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: node.color }}>
                <span aria-hidden="true">{node.icon}</span>
                {node.title}
              </div>
              <div className="mt-0.5 text-xs text-ink-2">{node.detail}</div>
            </div>
            {index < nodes.length - 1 && (
              <span aria-hidden="true" className="self-center text-muted">
                →
              </span>
            )}
          </li>
        ))}
      </ol>

      <p className="border-t border-hairline px-4 py-2.5 text-xs text-muted">
        {explain(event, now)}
      </p>
    </section>
  );
}

function buildNodes(event: EventDetail, now: number): Node[] {
  const nodes: Node[] = [
    {
      title: 'Accepted',
      detail: formatClock(event.createdAt),
      color: 'var(--series-1)',
      icon: '＋',
    },
  ];

  for (const attempt of event.attempts) {
    nodes.push(attemptNode(attempt));

    if (attempt.status === 'FAILED') {
      const isLast = attempt.attemptNumber === event.attempts.length;
      if (isLast && event.status === 'RETRYING') {
        const countdown = secondsUntil(event.nextAttemptAt, now);
        nodes.push({
          title: 'Retry scheduled',
          detail: `${formatClock(event.nextAttemptAt)} · ${formatCountdown(countdown)}`,
          color: STATUS_PRESENTATION.RETRYING.color,
          icon: STATUS_PRESENTATION.RETRYING.icon,
        });
        nodes.push({
          title: `Attempt ${attempt.attemptNumber + 1}`,
          detail: 'not started yet',
          color: 'var(--text-secondary)',
          icon: '◷',
          pending: true,
        });
      }
    }
  }

  if (event.status === 'DELIVERED' || event.status === 'FAILED') {
    const presentation = STATUS_PRESENTATION[event.status];
    nodes.push({
      title: presentation.label,
      detail: terminalReason(event),
      color: presentation.color,
      icon: presentation.icon,
    });
  }

  if (event.status === 'PENDING') {
    nodes.push({
      title: 'Attempt 1',
      detail: 'waiting for the worker',
      color: 'var(--text-secondary)',
      icon: '◷',
      pending: true,
    });
  }

  return nodes;
}

function attemptNode(attempt: DeliveryAttempt): Node {
  if (attempt.status === 'SUCCESS') {
    return {
      title: `Attempt ${attempt.attemptNumber}`,
      detail: `${attempt.httpStatus} OK · ${formatClock(attempt.startedAt)}`,
      color: STATUS_PRESENTATION.DELIVERED.color,
      icon: '✓',
    };
  }
  if (attempt.status === 'IN_PROGRESS') {
    return {
      title: `Attempt ${attempt.attemptNumber}`,
      detail: `in flight · ${formatClock(attempt.startedAt)}`,
      color: STATUS_PRESENTATION.DELIVERING.color,
      icon: '◆',
    };
  }
  return {
    title: `Attempt ${attempt.attemptNumber}`,
    detail: `${attempt.httpStatus ?? attempt.errorType} · ${formatClock(attempt.startedAt)}`,
    color: STATUS_PRESENTATION.FAILED.color,
    icon: '✕',
  };
}

function terminalReason(event: EventDetail): string {
  if (event.status === 'DELIVERED') return `on attempt ${event.attemptCount}`;
  return event.attemptCount >= event.maxAttempts ? 'retry limit reached' : 'permanent failure';
}

/** One plain sentence explaining why the event is in its current state. */
function explain(event: EventDetail, now: number): string {
  switch (event.status) {
    case 'PENDING':
      return 'Queued in the database. The worker claims it on its next poll.';
    case 'DELIVERING':
      return 'A worker holds the lease and the HTTP request is in flight.';
    case 'RETRYING':
      return `The last attempt failed with a retryable error, so the next of ${event.maxAttempts} attempts is scheduled ${formatCountdown(
        secondsUntil(event.nextAttemptAt, now),
      )}. ${event.attemptsRemaining} attempt(s) remaining.`;
    case 'DELIVERED':
      return `The receiver answered 2xx on attempt ${event.attemptCount}. Terminal state — no further attempts.`;
    case 'FAILED':
      return event.attemptCount >= event.maxAttempts
        ? `All ${event.maxAttempts} attempts failed with retryable errors. The retry limit is reached and no further attempts are scheduled.`
        : 'The receiver returned a permanent error, so retrying could not change the outcome. No retry was scheduled.';
    default:
      return '';
  }
}
