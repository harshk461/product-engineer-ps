import { DeliveryErrorType } from '../../src/common/attempt.enums';
import { WebhookDeliveryRequest, WebhookDeliveryResult } from '../../src/delivery/webhook.client';

export type ScriptedResponse =
  | { status: number }
  | { errorType: DeliveryErrorType; message?: string };

/**
 * Stands in for the HTTP layer so delivery-engine tests are deterministic.
 *
 * It returns the same normalised shape the real client returns, which is the
 * only thing the engine knows about HTTP.
 */
export class FakeWebhookClient {
  readonly requests: WebhookDeliveryRequest[] = [];
  private readonly script: ScriptedResponse[] = [];
  private fallback: ScriptedResponse = { status: 200 };

  respondWith(...responses: ScriptedResponse[]): this {
    this.script.push(...responses);
    return this;
  }

  alwaysRespondWith(response: ScriptedResponse): this {
    this.fallback = response;
    return this;
  }

  get callCount(): number {
    return this.requests.length;
  }

  async send(request: WebhookDeliveryRequest): Promise<WebhookDeliveryResult> {
    this.requests.push(request);
    const response = this.script.shift() ?? this.fallback;

    if ('status' in response) {
      const ok = response.status >= 200 && response.status < 300;
      return {
        responded: true,
        httpStatus: response.status,
        errorType: ok ? null : DeliveryErrorType.HTTP_ERROR,
        errorMessage: ok ? null : `${response.status} response from receiver`,
        durationMs: 1,
      };
    }

    return {
      responded: false,
      httpStatus: null,
      errorType: response.errorType,
      errorMessage: response.message ?? `${response.errorType} contacting receiver`,
      durationMs: 1,
    };
  }
}
