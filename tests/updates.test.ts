import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkForUpdate } from '../server/updates.js'

function github(tag: string, body = 'Changes') {
  return (async (input: string | URL | Request) => {
    assert.equal(String(input), 'https://api.github.com/repos/jsposu/pacc-bd/releases/latest')
    return Response.json({ tag_name: tag, body })
  }) as typeof fetch
}

test('only a newer official version offers its GitHub release; never auto-installs', async () => {
  assert.deepEqual(await checkForUpdate('1.1.0', github('v1.1.0')), { current: '1.1.0', latest: 'v1.1.0', available: false, notes: 'Changes', url: 'https://github.com/jsposu/pacc-bd/releases/tag/v1.1.0' })
  assert.equal((await checkForUpdate('1.1.0', github('v1.2.0'))).available, true)
  assert.equal((await checkForUpdate('1.1.0', github('v2.0.0'))).available, true)
  assert.equal((await checkForUpdate('1.11.0', github('v1.9.99'))).available, false)
  assert.equal((await checkForUpdate('2.0.0', github('v1.99.99'))).available, false)
  await assert.rejects(checkForUpdate('1.1.0', github('v1.2.0/../../evil')), /invalid release version/)
  await assert.rejects(checkForUpdate('1.1.0', github('v1.2.0-beta')), /invalid release version/)
})

test('update check fails visibly for GitHub errors or oversized payloads', async () => {
  await assert.rejects(checkForUpdate('1.1.0', (async () => new Response('', { status: 429 })) as typeof fetch), /HTTP 429/)
  await assert.rejects(checkForUpdate('1.1.0', (async () => new Response('x'.repeat(1024 * 1024 + 1))) as typeof fetch), /oversized/)
})
