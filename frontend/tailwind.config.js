/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#e8f7f5',
          100: '#d1efeb',
          200: '#a3dfd7',
          300: '#75cfc3',
          400: '#4EB8A9',
          500: '#4EB8A9',
          600: '#3d9a8e',
          700: '#2d7b72',
          800: '#1e5d55',
          900: '#0f3e39',
        },
        plum: {
          400: '#9a6488',
          500: '#7B4B6A',
          600: '#623c55',
          700: '#4a2d40',
        },
        peach: {
          300: '#f2d4c4',
          400: '#E5B49A',
          500: '#d99470',
        },
        wine: {
          500: '#9B2D35',
          600: '#7c242a',
          700: '#5d1b20',
        }
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif']
      }
    },
  },
  plugins: [],
}
