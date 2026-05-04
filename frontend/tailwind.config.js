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
          200: '#E8C9A0',
          300: '#D4A574',
          400: '#C49058',
          500: '#B07D3E',
          600: '#8B6430',
          700: '#6B4D25',
          800: '#4A3519',
          900: '#2A1F0F',
        },
        // Muted warm earth tones
        earth: {
          green: '#6EBF8B',
          sage: '#8BA888',
          rust: '#C47D5A',
          clay: '#9B7B6B',
          sand: '#C4B5A0',
        },
        // Deep background layers
        deep: {
          50: '#D4D0CC',
          100: '#A8A29E',
          200: '#787571',
          300: '#5A5550',
          400: '#3D3835',
          500: '#2A2624',
          600: '#1E1B19',
          700: '#161311',
          800: '#0F0D0C',
          900: '#0C0A09',
          950: '#080706',
        },
        // Status / accent
        status: {
          ok: '#6EBF8B',
          warn: '#D4A574',
          danger: '#C47D5A',
          info: '#8B9FBF',
        },
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Fira Code"', 'Menlo', 'monospace'],
        sans: ['"Inter"', '-apple-system', 'BlinkMacSystemFont', '"Noto Sans SC"', 'sans-serif'],
      },
      boxShadow: {
        'glow-sm': '0 0 10px rgba(212, 165, 116, 0.1)',
        'glow': '0 0 20px rgba(212, 165, 116, 0.12)',
        'glow-lg': '0 0 40px rgba(212, 165, 116, 0.15)',
        'glow-green': '0 0 15px rgba(110, 191, 139, 0.1)',
        'inner-glow': 'inset 0 0 30px rgba(212, 165, 116, 0.03)',
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
