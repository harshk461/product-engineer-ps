import {
  assertTransition,
  canTransition,
  DeliveryStatus,
  InvalidDeliveryTransitionError,
  isTerminal,
} from './delivery-status.enum';

describe('delivery state machine', () => {
  it('allows only the transitions in the specification', () => {
    expect(canTransition(DeliveryStatus.PENDING, DeliveryStatus.DELIVERING)).toBe(true);
    expect(canTransition(DeliveryStatus.DELIVERING, DeliveryStatus.DELIVERED)).toBe(true);
    expect(canTransition(DeliveryStatus.DELIVERING, DeliveryStatus.RETRYING)).toBe(true);
    expect(canTransition(DeliveryStatus.DELIVERING, DeliveryStatus.FAILED)).toBe(true);
    expect(canTransition(DeliveryStatus.RETRYING, DeliveryStatus.DELIVERING)).toBe(true);
  });

  it('rejects shortcuts around DELIVERING', () => {
    expect(canTransition(DeliveryStatus.PENDING, DeliveryStatus.DELIVERED)).toBe(false);
    expect(canTransition(DeliveryStatus.RETRYING, DeliveryStatus.FAILED)).toBe(false);
  });

  it('treats DELIVERED and FAILED as terminal', () => {
    for (const terminal of [DeliveryStatus.DELIVERED, DeliveryStatus.FAILED]) {
      expect(isTerminal(terminal)).toBe(true);
      for (const target of Object.values(DeliveryStatus)) {
        expect(canTransition(terminal, target)).toBe(false);
      }
    }
  });

  it('throws with context on an illegal transition', () => {
    expect(() => assertTransition(DeliveryStatus.DELIVERED, DeliveryStatus.DELIVERING, 'evt_1')).toThrow(
      InvalidDeliveryTransitionError,
    );
    expect(() => assertTransition(DeliveryStatus.DELIVERED, DeliveryStatus.DELIVERING, 'evt_1')).toThrow(
      /evt_1/,
    );
  });
});
