import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Queue } from '../server/queue.js'
import type { State } from '../server/types.js'

test('Dark is the default; old Team and OLED migrate to Dark while Light is preserved', () => {
  assert.equal(new Queue('/unused').state.theme, 'oled')
  for (const theme of [undefined, 'team', 'oled', 'light'] as const) {
    const state: State = { settings: { directory: '/unused', mirror: 'direct' }, collections: [], currentId: null, queue: [], paused: true, theme }
    assert.equal(new Queue('/unused', state).state.theme, theme === 'light' ? 'light' : 'oled')
  }
})

test('removed Team theme cannot be selected through the API', async () => {
  await assert.rejects(new Queue('/unused').setTheme('team'), /supported theme/)
})
