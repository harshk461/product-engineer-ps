/**
 * The delivery state machine.
 *
 *   PENDING ──► DELIVERING ──┬──► DELIVERED   (terminal)
 *      ▲                     │
 *      │                     ├──► RETRYING ──► DELIVERING
 *      │                     │
 *      └── (never)           └──► FAILED      (terminal)
 */
export enum DeliveryStatus {
  PENDING = 'PENDING',
  DELIVERING = 'DELIVERING',
  RETRYING = 'RETRYING',
  DELIVERED = 'DELIVERED',
  FAILED = 'FAILED',
}

export const TERMINAL_STATUSES: readonly DeliveryStatus[] = [
  DeliveryStatus.DELIVERED,
  DeliveryStatus.FAILED,
];

/** Statuses the worker is allowed to pick up. */
export const CLAIMABLE_STATUSES: readonly DeliveryStatus[] = [
  DeliveryStatus.PENDING,
  DeliveryStatus.RETRYING,
];

const ALLOWED_TRANSITIONS: Record<DeliveryStatus, readonly DeliveryStatus[]> = {
  [DeliveryStatus.PENDING]: [DeliveryStatus.DELIVERING],
  [DeliveryStatus.DELIVERING]: [
    DeliveryStatus.DELIVERED,
    DeliveryStatus.RETRYING,
    DeliveryStatus.FAILED,
  ],
  [DeliveryStatus.RETRYING]: [DeliveryStatus.DELIVERING],
  [DeliveryStatus.DELIVERED]: [],
  [DeliveryStatus.FAILED]: [],
};

export class InvalidDeliveryTransitionError extends Error {
  constructor(
    readonly from: DeliveryStatus,
    readonly to: DeliveryStatus,
    readonly eventId?: string,
  ) {
    super(
      `Invalid delivery transition ${from} -> ${to}${eventId ? ` for event ${eventId}` : ''}`,
    );
    this.name = 'InvalidDeliveryTransitionError';
  }
}

export function canTransition(from: DeliveryStatus, to: DeliveryStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: DeliveryStatus, to: DeliveryStatus, eventId?: string): void {
  if (!canTransition(from, to)) {
    throw new InvalidDeliveryTransitionError(from, to, eventId);
  }
}

export function isTerminal(status: DeliveryStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}
