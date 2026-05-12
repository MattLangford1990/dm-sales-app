// Brand catalogue. Tagline + accent colour drive the brand-section cards.
export const BRANDS = [
  {
    id: 'remember',
    name: 'Remember',
    tagline: 'Colourful design from Denmark',
    accent: 'from-rose-400 to-pink-500',
    origin: 'Denmark',
  },
  {
    id: 'rader',
    name: 'Räder',
    tagline: 'Poetic homeware from Germany',
    accent: 'from-stone-400 to-stone-600',
    origin: 'Germany',
  },
  {
    id: 'relaxound',
    name: 'Relaxound',
    tagline: 'Nature sounds for the home',
    accent: 'from-emerald-400 to-teal-600',
    origin: 'Germany',
  },
  {
    id: 'myflame',
    name: 'My Flame',
    tagline: 'Scented soy candles',
    accent: 'from-amber-400 to-orange-500',
    origin: 'Netherlands',
  },
  {
    id: 'ppd',
    name: 'Paper Products Design',
    tagline: 'Napkins, paper & gift wrap',
    accent: 'from-sky-400 to-blue-600',
    origin: 'Germany',
  },
  {
    id: 'i4s',
    name: 'Ideas4Seasons',
    tagline: 'Seasonal home decor',
    accent: 'from-violet-400 to-purple-600',
    origin: 'Netherlands',
  },
  {
    id: 'elvang',
    name: 'Elvang',
    tagline: 'Premium throws & blankets',
    accent: 'from-slate-400 to-slate-700',
    origin: 'Denmark',
  },
]

export const getBrand = (id) => BRANDS.find((b) => b.id === id)
