/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Deep space warm palette
        amber: {
          50: '#FFF8F0',
          100: '#FFE8CC',
          200: '#FBDDB3',
          300: '#F5C896',
          400: '#E0A972',
          500: '#C28950',
          600: '#9A6B38',
          700: '#75512A',
          800: '#4F371D',
          900: '#2D2010',
        },
        // Muted warm earth tones
        earth: {
          green: '#6EBF8B',
          sage: '#8BA888',
          rust: '#C47D5A',
          clay: '#9B7B6B',
          sand: '#C4B5A0',
        },
        // Deep background layers — text tones aggressively lifted
        deep: {
          50: '#FFFEFB',
          100: '#F2EDE7',
          200: '#DAD2C8',
          300: '#B5ABA0',
          400: '#7A736C',
          500: '#3A3633',
          600: '#28241F',
          700: '#1E1B17',
          800: '#161310',
          900: '#100D0B',
          950: '#0A0807',
        },
        // Status / accent
        status: {
          ok: '#6EBF8B',
          warn: '#D4A574',
          danger: '#C47D5A',
          info: '#8B9FBF',
        },
        // Cool accent — single hue for neutral/info data (balances amber).
        // Use sparingly: token counts, model labels, judge metadata, system status.
        cool: {
          200: '#C7D4E5',
          300: '#A8BCD8',
          400: '#8FA8C7',
          500: '#7591B5',
        },
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Fira Code"', 'Menlo', 'monospace'],
        sans: ['"Inter"', '-apple-system', 'BlinkMacSystemFont', '"Noto Sans SC"', 'sans-serif'],
      },
      boxShadow: {
        'glow-sm': '0 0 12px rgba(232, 185, 136, 0.20)',
        'glow': '0 0 22px rgba(232, 185, 136, 0.22)',
        'glow-lg': '0 0 42px rgba(232, 185, 136, 0.28)',
        'glow-green': '0 0 18px rgba(110, 191, 139, 0.20)',
        'inner-glow': 'inset 0 0 32px rgba(232, 185, 136, 0.06)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'scan': 'scan 6s linear infinite',
        'fade-in': 'fadeIn 0.5s ease-out',
        'slide-up': 'slideUp 0.4s ease-out',
        'glow-pulse': 'glowPulse 3s ease-in-out infinite',
      },
      keyframes: {
        scan: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100%)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        glowPulse: {
          '0%, 100%': { boxShadow: '0 0 4px rgba(212, 165, 116, 0.15)' },
          '50%': { boxShadow: '0 0 12px rgba(212, 165, 116, 0.3)' },
        },
      },
    },
  },
  plugins: [],
}
