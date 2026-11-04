import type { Config } from 'tailwindcss';

/**
 * Кольори оголошені через CSS-змінні (див. src/styles.css), тож перемикання
 * теми — це зміна одного атрибута на <html>, без дублювання класів у розмітці.
 * Формат `rgb(var(--x) / <alpha-value>)` дозволяє Tailwind-прозорості
 * штибу `bg-accent/10` працювати зі змінними.
 */
const withAlpha = (name: string) => `rgb(var(${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: withAlpha('--c-canvas'),
        surface: withAlpha('--c-surface'),
        elevated: withAlpha('--c-elevated'),
        line: withAlpha('--c-line'),
        ink: {
          DEFAULT: withAlpha('--c-ink'),
          soft: withAlpha('--c-ink-soft'),
          faint: withAlpha('--c-ink-faint'),
        },
        accent: {
          DEFAULT: withAlpha('--c-accent'),
          soft: withAlpha('--c-accent-soft'),
          ink: withAlpha('--c-accent-ink'),
        },
        income: withAlpha('--c-income'),
        expense: withAlpha('--c-expense'),
        debt: withAlpha('--c-debt'),
        warn: withAlpha('--c-warn'),
      },
      fontFamily: {
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'SF Pro Text',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
      },
      spacing: {
        // Безпечні зони iPhone: під «чубчик» і під домашній індикатор.
        'safe-t': 'env(safe-area-inset-top)',
        'safe-b': 'env(safe-area-inset-bottom)',
        // Висота нижньої навігації разом із safe-area.
        nav: 'calc(4rem + env(safe-area-inset-bottom))',
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1.25rem',
        '3xl': '1.75rem',
      },
      boxShadow: {
        card: '0 1px 2px rgb(0 0 0 / 0.16)',
        pop: '0 12px 40px rgb(0 0 0 / 0.32)',
        glow: '0 6px 24px rgb(var(--c-accent) / 0.35)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': {
          from: { transform: 'translateY(12px)', opacity: '0' },
          to: { transform: 'translateY(0)', opacity: '1' },
        },
        'sheet-in': {
          from: { transform: 'translateY(100%)' },
          to: { transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.18s ease-out',
        'slide-up': 'slide-up 0.22s cubic-bezier(0.22, 1, 0.36, 1)',
        'sheet-in': 'sheet-in 0.26s cubic-bezier(0.22, 1, 0.36, 1)',
      },
    },
  },
  plugins: [],
} satisfies Config;
