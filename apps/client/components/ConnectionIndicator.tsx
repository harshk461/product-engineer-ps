import type { ConnectionState } from '@/hooks/useEngineState';

const PRESENTATION: Record<ConnectionState, { label: string; color: string; hint: string }> = {
  live: {
    label: 'Live',
    color: 'var(--status-good)',
    hint: 'Receiving real-time updates over the websocket',
  },
  connecting: {
    label: 'Connecting',
    color: 'var(--status-warning)',
    hint: 'Establishing the websocket connection',
  },
  offline: {
    label: 'Offline',
    color: 'var(--status-critical)',
    hint: 'Websocket disconnected. Delivery continues on the server; state is re-read from REST on reconnect.',
  },
};

export function ConnectionIndicator({ state }: { state: ConnectionState }) {
  const presentation = PRESENTATION[state];

  return (
    <span
      className="badge"
      style={{
        color: presentation.color,
        borderColor: `color-mix(in srgb, ${presentation.color} 40%, transparent)`,
        background: `color-mix(in srgb, ${presentation.color} 12%, transparent)`,
      }}
      title={presentation.hint}
    >
      <span aria-hidden="true">●</span>
      {presentation.label}
    </span>
  );
}
