import { difficultyColour, difficultyTextColour } from './difficultyColours'

export function StarRating({ stars }: { stars: number }) {
  return <b className="lazer-star-rating" style={{ background: stars < .1 ? '#aaaaaa' : difficultyColour(stars), color: difficultyTextColour(stars) }}><span aria-hidden="true">★</span> {stars.toFixed(2)}</b>
}
