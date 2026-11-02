// Adapted from ppy/osu (MIT), osu.Game/Graphics/OsuColour.cs and
// Screens/Select/FilterControl.DifficultyRangeSlider.cs. See THIRD_PARTY_NOTICES.md.
export const difficultySpectrum: readonly (readonly [number, string])[] = [
  [0, '#4290fb'], [.1, '#4290fb'], [1.25, '#4fc0ff'], [2, '#4fffd5'], [2.5, '#7cff4f'],
  [3.3, '#f6f05c'], [4.2, '#ff8068'], [4.9, '#ff4e6f'], [5.8, '#c645b8'],
  [6.7, '#6563de'], [7.7, '#18158e'], [9, '#000000'], [10, '#000000'],
]
function sample(stops: readonly (readonly [number, string])[], value: number): string {
  for (let i = 1; i < stops.length; i++) {
    if (value > stops[i][0]) continue
    const [a, ca] = stops[i - 1], [b, cb] = stops[i], t = Math.max(0, (value - a) / (b - a))
    // osu!framework interpolates colours in linear light, not sRGB.
    const linear = (v: number) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4
    const srgb = (v: number) => v <= .0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - .055
    const channel = (c: string, n: number) => parseInt(c.slice(n, n + 2), 16) / 255
    const rgb = [1, 3, 5].map(n => Math.round(srgb(linear(channel(ca, n)) * (1 - t) + linear(channel(cb, n)) * t) * 255).toString(16).padStart(2, '0'))
    return `#${rgb.join('')}`
  }
  return stops.at(-1)![1]
}
export function difficultyColour(value: number): string { return sample(difficultySpectrum, value) }
export function difficultyHandleColour(value: number): string {
  if (value >= 8) return '#444444'
  if (value >= 7.5) return sample([[7.5, difficultyColour(7.5)], [8, '#444444']], value)
  return difficultyColour(value)
}
export function difficultyTextColour(value: number): string {
  if (value < 6.5) return '#000000bf'
  if (value < 9) return '#ffd966'
  return sample([[9, '#f6f05c'], [9.9, '#ff8068'], [10.6, '#ff4e6f'], [11.5, '#c645b8'], [12.4, '#6563de']], value)
}
export function difficultyGradient(maximum = 10): string {
  // Sample between official stops to retain the linear-light interpolation in CSS.
  const values = new Set([...difficultySpectrum.map(([n]) => n), ...Array.from({ length: 101 }, (_, i) => i / 10)])
  return `linear-gradient(90deg, ${[...values].filter(n => n <= maximum).sort((a, b) => a - b).map(n => `${difficultyColour(n)} ${n / maximum * 100}%`).join(', ')}, #000 ${Math.min(100, 10 / maximum * 100)}%, #000 100%)`
}
