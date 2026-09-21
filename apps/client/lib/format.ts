export function formatClock(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleString([], { hour12: false });
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms / 60_000)} min`;
}

/** Seconds until `target`, floored at zero. */
export function secondsUntil(target: string | null | undefined, now = Date.now()): number | null {
  if (!target) return null;
  return Math.max(0, Math.round((new Date(target).getTime() - now) / 1000));
}

export function formatCountdown(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds === 0) return 'due now';
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `in ${minutes}m ${String(rest).padStart(2, '0')}s` : `in ${rest}s`;
}

export function titleCase(value: string): string {
  return value
    .split('_')
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(' ');
}
