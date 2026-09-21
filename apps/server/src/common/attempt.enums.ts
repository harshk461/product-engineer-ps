export enum AttemptStatus {
  /** The HTTP call is in flight. Left behind if the worker crashes mid-attempt. */
  IN_PROGRESS = 'IN_PROGRESS',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}

/**
 * Why an attempt failed. HTTP_ERROR means the receiver answered with a non-2xx
 * status; everything else means the request never produced a response.
 */
export enum DeliveryErrorType {
  HTTP_ERROR = 'HTTP_ERROR',
  TIMEOUT = 'TIMEOUT',
  CONNECTION_REFUSED = 'CONNECTION_REFUSED',
  DNS_ERROR = 'DNS_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',
  /** The worker died while this attempt was in flight; recovered by the lease sweep. */
  WORKER_CRASH = 'WORKER_CRASH',
  UNKNOWN = 'UNKNOWN',
}

/** How the retry policy classified a failed attempt. */
export enum FailureClassification {
  RETRYABLE = 'RETRYABLE',
  PERMANENT = 'PERMANENT',
}
