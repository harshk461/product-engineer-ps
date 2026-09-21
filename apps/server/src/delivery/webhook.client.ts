import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { AxiosError, AxiosResponse } from 'axios';
import { createHmac } from 'node:crypto';
import { firstValueFrom } from 'rxjs';
import { DeliveryErrorType } from '../common/attempt.enums';
import { AppConfigService } from '../config/app-config.service';

export interface WebhookDeliveryRequest {
  eventId: string;
  type: string;
  occurredAt: Date;
  payload: Record<string, unknown>;
  attemptNumber: number;
}

export interface WebhookDeliveryResult {
  /** True when the receiver answered at all, regardless of status code. */
  responded: boolean;
  httpStatus: number | null;
  errorType: DeliveryErrorType | null;
  errorMessage: string | null;
  durationMs: number;
}

/**
 * The only place that speaks HTTP.
 *
 * It never throws for a delivery outcome and it never decides policy: it
 * returns a normalised result and lets the retry policy classify it. That
 * split is what keeps the worker free of transport details.
 */
@Injectable()
export class WebhookClient {
  private readonly logger = new Logger(WebhookClient.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: AppConfigService,
  ) {}

  async send(request: WebhookDeliveryRequest): Promise<WebhookDeliveryResult> {
    const { targetUrl, timeoutMs, signingSecret } = this.config.webhook;
    const body = {
      eventId: request.eventId,
      type: request.type,
      occurredAt: request.occurredAt.toISOString(),
      payload: request.payload,
    };
    const serialized = JSON.stringify(body);
    const startedAt = Date.now();

    try {
      const response: AxiosResponse = await firstValueFrom(
        this.http.post(targetUrl, body, {
          timeout: timeoutMs,
          headers: {
            'Content-Type': 'application/json',
            // The receiver uses this as its own idempotency key: delivery is
            // at-least-once, so the same eventId can legitimately arrive twice.
            'X-Webhook-Event-Id': request.eventId,
            'X-Webhook-Event-Type': request.type,
            'X-Webhook-Attempt': String(request.attemptNumber),
            'X-Webhook-Timestamp': new Date().toISOString(),
            'X-Webhook-Signature': sign(serialized, signingSecret),
          },
          // Status codes are data, not exceptions -- classification happens in
          // the retry policy, not in a catch block.
          validateStatus: () => true,
          transitional: { clarifyTimeoutError: true },
        }),
      );

      return {
        responded: true,
        httpStatus: response.status,
        errorType: response.status >= 200 && response.status < 300 ? null : DeliveryErrorType.HTTP_ERROR,
        errorMessage:
          response.status >= 200 && response.status < 300
            ? null
            : describeHttpFailure(response),
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      const mapped = mapTransportError(error);
      this.logger.warn(
        `Transport failure delivering ${request.eventId} (attempt ${request.attemptNumber}): ${mapped.errorMessage}`,
      );
      return { ...mapped, responded: false, durationMs: Date.now() - startedAt };
    }
  }
}

function sign(body: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

function describeHttpFailure(response: AxiosResponse): string {
  const statusText = response.statusText || httpReason(response.status);
  const body = typeof response.data === 'string' ? response.data : JSON.stringify(response.data ?? '');
  const detail = body && body !== '{}' && body !== '""' ? ` ${body.slice(0, 300)}` : '';
  return `${response.status} ${statusText}${detail}`.trim();
}

function httpReason(status: number): string {
  const reasons: Record<number, string> = {
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    405: 'Method Not Allowed',
    408: 'Request Timeout',
    422: 'Unprocessable Entity',
    429: 'Too Many Requests',
    500: 'Internal Server Error',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
    504: 'Gateway Timeout',
  };
  return reasons[status] ?? 'HTTP Error';
}

/** Turn an axios/node transport failure into one of our error types. */
export function mapTransportError(error: unknown): {
  httpStatus: null;
  errorType: DeliveryErrorType;
  errorMessage: string;
} {
  const axiosError = error as AxiosError;
  const code = axiosError?.code;
  const message = axiosError?.message ?? String(error);

  const errorType = (() => {
    switch (code) {
      case 'ECONNABORTED':
      case 'ETIMEDOUT':
      case 'ERR_CANCELED':
        return DeliveryErrorType.TIMEOUT;
      case 'ECONNREFUSED':
        return DeliveryErrorType.CONNECTION_REFUSED;
      case 'ENOTFOUND':
      case 'EAI_AGAIN':
        return DeliveryErrorType.DNS_ERROR;
      case 'ECONNRESET':
      case 'EPIPE':
      case 'EHOSTUNREACH':
      case 'ENETUNREACH':
      case 'ERR_BAD_RESPONSE':
        return DeliveryErrorType.NETWORK_ERROR;
      default:
        return code ? DeliveryErrorType.NETWORK_ERROR : DeliveryErrorType.UNKNOWN;
    }
  })();

  return {
    httpStatus: null,
    errorType,
    errorMessage: code ? `${code}: ${message}` : message,
  };
}
