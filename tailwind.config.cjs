/** @type {import('tailwindcss').Config} */
// Tokens are copied 1:1 from the Shifter Panel (tailwind.config.js +
// resources/css/panel-tailwind.css) so the extension, panel and marketing
// site share one visual language. Change them there first, then here.
module.exports = {
  content: ['./src/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        sf: {
          'bg-deepest': '#0B0E17',
          'bg-deep': '#060810',
          'bg-card': '#0F1320',
          'bg-card-hover': '#141A2B',
          'bg-elevated': '#131927',
          'bg-stripe': '#0D111C',
          'bg-input': '#0C0F1A',
          'border-subtle': 'rgba(255,255,255,0.06)',
          'border-medium': 'rgba(255,255,255,0.12)',
          'border-strong': 'rgba(255,255,255,0.18)',
          'border-input': 'rgba(255,255,255,0.08)',
          'text-primary': '#F5F7FA',
          'text-secondary': '#B7BFD0',
          'text-tertiary': '#8893A8',
          'text-muted': '#5C6680',
          'text-faint': '#3E4660',
          accent: '#2B7FFF',
          'accent-hover': '#1554b0',
          'accent-light': '#5BA3FF',
          'accent-soft': 'rgba(43,127,255,0.08)',
          'accent-softer': 'rgba(43,127,255,0.04)',
          cyan: '#06B6D4',
          success: '#3dba78',
          warning: '#e59a30',
          danger: '#ef4444',
          purple: '#9b6cff',
          'bar-track': 'rgba(255,255,255,0.06)',
        },
      },
      fontFamily: {
        sans: ['Geist', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"Geist Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: {
        sm: '6px',
        md: '8px',
        DEFAULT: '10px',
        lg: '10px',
        xl: '14px',
        card: '14px',
      },
      boxShadow: {
        'sf-glow': '0 0 0 1px rgba(43,127,255,0.20), 0 8px 32px -8px rgba(43,127,255,0.35)',
        'sf-card': '0 1px 0 rgba(255,255,255,0.03) inset, 0 8px 24px -12px rgba(0,0,0,0.6)',
        'sf-overlay': '0 24px 64px -16px rgba(0,0,0,0.7)',
      },
      keyframes: {
        'sf-slide-up': {
          '0%': { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'sf-fade-in': { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        'sf-shimmer': {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
        'sf-blob-1': {
          '0%, 100%': { transform: 'translate(0,0) scale(1)' },
          '33%': { transform: 'translate(40px,-30px) scale(1.05)' },
          '66%': { transform: 'translate(-30px,20px) scale(0.96)' },
        },
        'sf-spin': { to: { transform: 'rotate(360deg)' } },
        'sf-pop': {
          from: { transform: 'scale(0.4)', opacity: '0' },
          to: { transform: 'scale(1)', opacity: '1' },
        },
        'sf-ring': {
          '0%': { transform: 'scale(0.9)', opacity: '0.55' },
          '100%': { transform: 'scale(1.55)', opacity: '0' },
        },
      },
      animation: {
        'sf-slide-up': 'sf-slide-up 0.5s cubic-bezier(0.16, 1, 0.3, 1) both',
        'sf-fade-in': 'sf-fade-in 0.4s ease both',
        'sf-shimmer': 'sf-shimmer 1.5s infinite',
        'sf-blob-1': 'sf-blob-1 25s ease-in-out infinite',
        'sf-spin': 'sf-spin 0.85s linear infinite',
        'sf-pop': 'sf-pop 0.25s ease-out',
        'sf-ring': 'sf-ring 2.4s cubic-bezier(0.16, 1, 0.3, 1) infinite',
      },
    },
  },
  plugins: [],
};
