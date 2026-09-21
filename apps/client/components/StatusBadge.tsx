import { STATUS_PRESENTATION } from '@/lib/status';
import type { DeliveryStatus } from '@/types';

/** Colour + icon + written label, so status never depends on hue alone. */
export function StatusBadge({ status, title }: { status: DeliveryStatus; title?: string }) {
  const presentation = STATUS_PRESENTATION[status];

  return (
    <span
      className="badge"
      style={{
        color: presentation.color,
        background: presentation.tint,
        borderColor: presentation.border,
      }}
      title={title ?? presentation.description}
    >
      <span aria-hidden="true">{presentation.icon}</span>
      {presentation.label}
    </span>
  );
}
