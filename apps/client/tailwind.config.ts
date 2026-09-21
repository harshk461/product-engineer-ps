import type { Config } from 'tailwindcss';

/**
 * Colours are declared as CSS custom properties in app/globals.css so light and
 * dark are two selected palettes rather than an automatic inversion.
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        page: 'var(--page)',
        surface: 'var(--surface-1)',
        raised: 'var(--surface-2)',
        ink: 'var(--text-primary)',
        'ink-2': 'var(--text-secondary)',
        muted: 'var(--text-muted)',
        hairline: 'var(--hairline)',
        grid: 'var(--gridline)',
        good: 'var(--status-good)',
        warning: 'var(--status-warning)',
        serious: 'var(--status-serious)',
        critical: 'var(--status-critical)',
        info: 'var(--series-1)',
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
