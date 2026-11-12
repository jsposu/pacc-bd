import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { BeatmapCard } from '../src/BeatmapCard'
import { DownloadQueue } from '../src/DownloadQueue'
import { queueSummary, sortMapGroups } from '../src/listing'
import { HeaderBackdrop, makeHeaderTriangles } from '../src/HeaderBackdrop'
import { bpmColour, bpmGradient } from '../src/bpmColours'
import { MapFiltersPanel } from '../src/MapFiltersPanel'
import { emptyFilters } from '../src/mapFilters'
import type { QueueItem } from '../server/types'

function item(key: string, status: QueueItem['status']): QueueItem {
  return { key, collectionId: 1, collectionName: 'Test', beatmapsetId: Number(key), artist: 'Artist', title: `Map ${key}`, difficultyIds: [], status, filename: `${key}.osz`, filePath: null, bytes: 40, total: 100, error: null, attempts: 0 }
}
test('listing sorting is stable, keeps unknown stars last and never mutates preview order', () => {
  const groups: { title: string; artist: string; stars: number | null }[][] = [[{ title: 'Zeta', artist: 'B', stars: 2 }], [{ title: 'alpha', artist: 'C', stars: null }], [{ title: 'Beta', artist: 'A', stars: 5 }]]
  assert.equal(sortMapGroups(groups, 'original'), groups)
  assert.deepEqual(sortMapGroups(groups, 'title').map(m => m[0].title), ['alpha', 'Beta', 'Zeta'])
  assert.deepEqual(sortMapGroups(groups, 'difficulty').map(m => m[0].stars), [5, 2, null])
  assert.deepEqual(sortMapGroups(groups, 'artist').map(m => m[0].artist), ['A', 'B', 'C'])
  assert.equal(groups[0][0].title, 'Zeta')
})
test('queue summary keeps FIFO order, reports active bytes and never counts failures as complete', () => {
  const queue = [item('1', 'done'), item('2', 'downloading'), item('3', 'pending'), item('4', 'failed'), item('5', 'cancelled')]
  const summary = queueSummary(queue, false)
  assert.equal(summary.active?.key, '2')
  assert.equal(summary.percent, 40)
  assert.deepEqual([summary.done, summary.total, summary.waiting, summary.failed, summary.cancelled], [1, 5, 1, 1, 1])
  assert.equal(queueSummary(queue, true).status, 'downloading', 'pause lets the current file finish')
  assert.deepEqual(queue.map(i => i.key), ['1', '2', '3', '4', '5'])
  assert.equal(queueSummary([item('1', 'pending')], true).status, 'paused')
  assert.equal(queueSummary([item('1', 'failed')], false).status, 'attention')
  assert.equal(queueSummary([item('1', 'cancelled')], false).status, 'cancelled')
  assert.equal(queueSummary([item('1', 'done')], false).status, 'allDone')
  assert.equal(queueSummary([], false).status, 'ready')
})
test('unknown transfer length is indeterminate, not an invented percentage', () => {
  const active = { ...item('1', 'downloading'), total: null }
  assert.equal(queueSummary([active], false).percent, null)
  const html = renderToStaticMarkup(<DownloadQueue queue={[active]} paused={false} language="en" onAction={async () => {}} />)
  assert.match(html, /size unknown/)
  assert.doesNotMatch(html.match(/<progress[^>]*>/)?.[0] || '', /value=/)
})
test('queue rows render oldest first and the active item is exposed even with the detail closed', () => {
  const html = renderToStaticMarkup(<DownloadQueue queue={[item('1', 'done'), item('2', 'downloading'), item('3', 'pending')]} paused={false} language="es" onAction={async () => {}} />)
  assert.ok(html.indexOf('data-queue-key="1"') < html.indexOf('data-queue-key="2"'))
  assert.ok(html.indexOf('data-queue-key="2"') < html.indexOf('data-queue-key="3"'))
  assert.match(html, /Descargando: Artist — Map 2/)
  assert.match(html, /40%/)
  assert.match(html, /1 de 3 completados/)
})
test('map cards link to official set pages and expose single-set download separately from selection', () => {
  const html = renderToStaticMarkup(<BeatmapCard setId={42} title="Song" artist="Artist" creator="Mapper" cover={null} status="ranked" language="en" selected={false} onSelect={() => {}} onDownload={async () => {}} difficulties={[{ key: '1', version: 'Hard', mode: 'osu', stars: 4.2, onSelect: () => {} }]} />)
  assert.match(html, /href="https:\/\/osu.ppy.sh\/beatmapsets\/42"/)
  assert.match(html, /aria-label="Download beatmapset: Song"/)
  assert.match(html, /Hard · 4.20★/)
  assert.match(html, /type="checkbox"/)
  assert.match(html, /class="beatmap-card-open"[^>]*><\/a>/, 'the cover remains a link without an overlay icon')
  assert.doesNotMatch(html, /lucide-external-link/)
})

test('the decorative header fills exactly half its grid with equal-sized random triangles', () => {
  const triangles = makeHeaderTriangles(() => .42)
  assert.equal(triangles.length, 24)
  assert.equal(new Set(triangles.map(triangle => triangle.cell)).size, 24)
  for (const triangle of triangles) {
    const points = triangle.points.split(' ').map(pair => pair.split(',').map(Number))
    assert.equal(Math.max(...points.map(point => point[0])) - Math.min(...points.map(point => point[0])), 70)
    assert.equal(Math.max(...points.map(point => point[1])) - Math.min(...points.map(point => point[1])), 60)
  }
  assert.notDeepEqual(triangles, makeHeaderTriangles(() => .73))
  const html = renderToStaticMarkup(<HeaderBackdrop cover="https://assets.ppy.sh/beatmaps/42/covers/cover.jpg" />)
  assert.match(html, /class="header-map-glow"/)
  assert.match(html, /src="https:\/\/assets.ppy.sh\/beatmaps\/42\/covers\/cover.jpg"/)
  assert.equal((html.match(/<polygon /g) || []).length, 24)
})
test('BPM has a fixed blue-to-red tempo palette, with no star-spectrum black endpoint', () => {
  assert.equal(bpmColour(0), '#58a6ff')
  assert.equal(bpmColour(80), '#58a6ff')
  assert.equal(bpmColour(320), '#ef6575')
  assert.equal(bpmColour(900), '#ef6575')
  assert.notEqual(bpmColour(200), bpmColour(80))
  assert.match(bpmGradient(400), /#ef6575 100%/)
  assert.match(bpmGradient(800), /#ef6575 40%/)
})
test('stars remain primary while BPM belongs to the advanced slider group', () => {
  const html = renderToStaticMarkup(<MapFiltersPanel listing language="en" maps={[{ stars: 4, bpm: 180 }]} filters={emptyFilters} onChange={() => {}} id="test-filters" />)
  const primary = html.slice(html.indexOf('class="lazer-primary-ranges"'), html.indexOf('class="filter-toolbar"'))
  assert.match(primary, /Star rating minimum/)
  assert.doesNotMatch(primary, /BPM minimum/)
  assert.match(html.slice(html.indexOf('class="lazer-extra-ranges"')), /BPM minimum/)
})
test('already queued cards disable download and missing-set cards cannot enqueue', () => {
  for (const queued of [item('42', 'pending'), item('42', 'downloading'), item('42', 'done'), item('42', 'failed')]) {
    const html = renderToStaticMarkup(<BeatmapCard setId={42} title="Song" artist="Artist" creator="Mapper" cover={null} status="ranked" language="es" selected={false} onSelect={() => {}} onDownload={async () => {}} difficulties={[]} queued={queued} />)
    assert.match(html.match(/<button[^>]*class="card-download"[^>]*>/)?.[0] || '', /disabled/)
  }
  const html = renderToStaticMarkup(<BeatmapCard setId={null} title="Song" artist="Artist" creator="Mapper" cover={null} status="ranked" language="en" selected={false} onSelect={() => {}} onDownload={async () => {}} difficulties={[]} />)
  assert.doesNotMatch(html, /href=/)
  assert.match(html.match(/<button[^>]*class="card-download"[^>]*>/)?.[0] || '', /disabled/)
})
