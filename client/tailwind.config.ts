import type { Config } from 'tailwindcss'

export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: '#0f1117',
        surface: '#161b22',
        border: '#30363d',
        'text-primary': '#e6edf3',
        'text-muted': '#8b949e',
        accent: '#58a6ff',
        success: '#3fb950',
        warning: '#d29922',
        error: '#f85149',
      },
    },
  },
  plugins: [],
} satisfies Config
