export type DeliveryStatus = 'PENDING' | 'DELIVERING' | 'RETRYING' | 'DELIVERED' | 'FAILED';
export type AttemptStatus = 'IN_PROGRESS' | 'SUCCESS' | 'FAILED';

export type RealtimeEventType =
  | 'event.accepted'
  | 'duplicate.event'
  | 'delivery.started'
  | 'delivery.succeeded'
  | 'delivery.failed'
  | 'delivery.retry_scheduled'
  | 'delivery.exhausted'
  | 'delivery.recovered'
  | 'receiver.delivery_received'
  | 'receiver.config_changed';

export interface RealtimeEvent {
  type: RealtimeEventType;
  eventId: string;
  message: string;
  emittedAt: string;
  status?: DeliveryStatus;
  eventType?: string;
  attemptNumber?: number;
  maxAttempts?: number;
  httpStatus?: number | null;
  errorType?: string | null;
  errorMessage?: string | null;
  classification?: 'RETRYABLE' | 'PERMANENT';
  nextAttemptAt?: string | null;
  attemptsRemaining?: number;
  durationMs?: number;
  duplicate?: boolean;
  /** Client-side only: reconstructed from REST rather than received live. */
  historical?: boolean;
}

export interface EventSummary {
  eventId: string;
  type: string;
  status: DeliveryStatus;
  occurredAt: string;
  createdAt: string;
  updatedAt: string;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  lastError: { httpStatus: number | null; errorType: string | null; message: string | null } | null;
}

export interface DeliveryAttempt {
  id: string;
  eventId: string;
  attemptNumber: number;
  startedAt: string;
  completedAt: string | null;
  status: AttemptStatus;
  httpStatus: number | null;
  errorType: string | null;
  errorMessage: string | null;
}

export interface EventDetail extends EventSummary {
  payload: Record<string, unknown>;
  attemptsRemaining: number;
  attempts: DeliveryAttempt[];
}

export interface DashboardStats {
  totals: {
    events: number;
    pending: number;
    delivering: number;
    retrying: number;
    delivered: number;
    failed: number;
  };
  attempts: { total: number; succeeded: number; failed: number; inProgress: number; averagePerEvent: number };
  delivery: {
    maxAttempts: number;
    averageDeliveryLatencyMs: number | null;
    averageAttemptDurationMs: number | null;
    averageWorkerTickMs: number | null;
    successRate: number | null;
  };
  httpStatusDistribution: Record<string, number>;
  counters: Record<string, number>;
  realtime: { connectedClients: number };
  generatedAt: string;
}

export type ReceiverMode = 'SUCCESS' | 'FAIL_ONCE' | 'FAIL_ALWAYS';

export interface ReceiverConfig {
  mode: ReceiverMode;
  failureStatus: number;
  latencyMs: number;
}

export interface ReceiverStats {
  totalReceived: number;
  uniqueEvents: number;
  duplicateDeliveries: number;
  lastReceivedAt: string | null;
}

export interface ReceiverState {
  config: ReceiverConfig;
  stats: ReceiverStats;
}

export interface IngestResponse {
  accepted: boolean;
  duplicate: boolean;
  eventId: string;
  status: DeliveryStatus;
  message: string;
}
