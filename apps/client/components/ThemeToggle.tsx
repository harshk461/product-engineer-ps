'use client';

import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark' | 'system';

/** Dark mode is a selected palette, not an inversion; the toggle wins over the OS setting. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system');

  useEffect(() => {
    const stored = window.localStorage.getItem('theme') as Theme | null;
    if (stored) applyTheme(stored);
    setTheme(stored ?? 'system');
  }, []);

  function update(next: Theme) {
    setTheme(next);
    applyTheme(next);
    window.localStorage.setItem('theme', next);
  }

  const order: Theme[] = ['system', 'light', 'dark'];
  const icons: Record<Theme, string> = { system: '◑', light: '☀', dark: '☾' };

  return (
    <button
      type="button"
      className="btn-ghost px-2.5 py-1.5 text-xs"
      onClick={() => update(order[(order.indexOf(theme) + 1) % order.length])}
      title={`Theme: ${theme}. Click to change.`}
    >
      <span aria-hidden="true">{icons[theme]}</span>
      <span className="capitalize">{theme}</span>
    </button>
  );
}

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}
