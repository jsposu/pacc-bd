const blue = [88, 166, 255], red = [239, 101, 117]

// A tempo cue, not a calculated difficulty rating. Fixed BPM anchors keep colours
// consistent between collections even when a slider has a larger maximum.
export function bpmColour(bpm: number): string {
  const amount = Math.max(0, Math.min(1, (bpm - 80) / 240))
  return `#${blue.map((channel, index) => Math.round(channel + (red[index] - channel) * amount).toString(16).padStart(2, '0')).join('')}`
}
export function bpmGradient(maximum: number): string {
  const stops = [...new Set([0, 80, 200, 320, maximum])].filter(value => value <= maximum).sort((a, b) => a - b)
  return `linear-gradient(90deg, ${stops.map(value => `${bpmColour(value)} ${value / maximum * 100}%`).join(', ')})`
}
