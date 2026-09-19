/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // SIITEC Design Tokens
        siitec: {
          bg:       '#181818', // zinc-900 equivalent
          card:     '#282828', // zinc-800 equivalent
          border:   '#3f3f46', // zinc-700
          hover:    '#303030', // slightly lighter than card
          accent:   '#f5a623', // golden yellow (yellow-400 approx)
          accent2:  '#eab308', // yellow-500
          text:     '#ffffff',
          muted:    '#a1a1aa', // zinc-400
          danger:   '#ef4444', // red-500
          success:  '#22c55e', // green-500
          warning:  '#f59e0b', // amber-500
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      animation: {
        'pulse-fast': 'pulse 0.8s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.3s ease-in-out',
        'slide-up': 'slideUp 0.4s ease-out',
        'glow-green': 'glowGreen 1s ease-in-out infinite alternate',
        'glow-red': 'glowRed 0.5s ease-in-out infinite alternate',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        glowGreen: {
          '0%': { boxShadow: '0 0 20px rgba(34, 197, 94, 0.4)' },
          '100%': { boxShadow: '0 0 60px rgba(34, 197, 94, 0.9)' },
        },
        glowRed: {
          '0%': { boxShadow: '0 0 20px rgba(239, 68, 68, 0.4)' },
          '100%': { boxShadow: '0 0 60px rgba(239, 68, 68, 0.9)' },
        },
      }
    },
  },
  plugins: [],
}
