import { useState } from 'react'

export function makeHeaderTriangles(random: () => number = Math.random) {
  const cells = Array.from({ length: 48 }, (_, index) => index)
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[cells[i], cells[j]] = [cells[j], cells[i]]
  }
  // Half of the grid is occupied. All triangles share the same 70 × 60 size.
  return cells.slice(0, cells.length / 2).map(cell => {
    const x = cell % 24 * 70, y = Math.floor(cell / 24) * 60
    return { cell, points: random() < .5 ? `${x},${y} ${x + 70},${y} ${x + 35},${y + 60}` : `${x},${y + 60} ${x + 70},${y + 60} ${x + 35},${y}`, opacity: .07 + random() * .12 }
  })
}

export function HeaderBackdrop({ cover }: { cover: string | null }) {
  // Generate once per window, not on every queue refresh or filter update.
  const [triangles] = useState(() => makeHeaderTriangles())
  const [brokenCover, setBrokenCover] = useState<string | null>(null)
  return <div className="header-ambience" aria-hidden="true">
    <div className="header-map-glow">{cover && cover !== brokenCover && <img src={cover} alt="" onError={() => setBrokenCover(cover)} />}</div>
    <div className="header-ambience-shade" />
    <svg className="header-triangles" viewBox="0 0 1680 120" preserveAspectRatio="xMidYMin slice" focusable="false">
      {triangles.map(triangle => <polygon key={triangle.cell} points={triangle.points} opacity={triangle.opacity} />)}
    </svg>
  </div>
}
