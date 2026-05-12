export const gbp = (n) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(n || 0)

export const stockLabel = (qty) => {
  if (qty <= 0) return { text: 'Out of stock', cls: 'bg-red-100 text-red-700' }
  if (qty < 20) return { text: `Low · ${qty}`, cls: 'bg-amber-100 text-amber-800' }
  return { text: `In stock · ${qty}`, cls: 'bg-green-100 text-green-700' }
}
