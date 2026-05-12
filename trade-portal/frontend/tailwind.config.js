/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  safelist: [
    // Brand-banner gradients are composed dynamically (`${brand.accent}`),
    // so Tailwind's content scanner can't see them. Force-include each pair.
    'from-rose-400', 'to-pink-500',
    'from-stone-400', 'to-stone-600',
    'from-emerald-400', 'to-teal-600',
    'from-amber-400', 'to-orange-500',
    'from-sky-400', 'to-blue-600',
    'from-violet-400', 'to-purple-600',
    'from-slate-400', 'to-slate-700',
    'from-gray-300', 'to-gray-500',
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          900: '#0f172a',
          800: '#1e293b',
          700: '#334155',
        },
        brand: {
          50: '#fef7f0',
          100: '#fdebd9',
          500: '#e07a3c',
          600: '#c95f24',
          700: '#a4491c',
          800: '#7a3414',
        },
      },
    },
  },
  plugins: [],
}
