import assert from 'node:assert/strict'
import { test } from 'node:test'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { request as httpRequest } from 'node:http'
import { startServer } from '../server/app.js'

test('production server serves the built app and local API on an ephemeral loopback port only', async t => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'pacc-bd-desktop-'))
  await fs.mkdir(path.join(root, 'dist'))
  await fs.writeFile(path.join(root, 'dist', 'index.html'), '<title>PACC-BD</title>')
  const previous = process.env.PACC_BD_DATA_DIR
  process.env.PACC_BD_DATA_DIR = path.join(root, 'state')
  t.after(() => { if (previous === undefined) delete process.env.PACC_BD_DATA_DIR; else process.env.PACC_BD_DATA_DIR = previous })
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const { server, port } = await startServer({ port: 0, root, production: true })
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())))
  const address = server.address()
  assert.equal(address && typeof address !== 'string' ? address.address : null, '127.0.0.1')
  assert.ok(port > 0)
  const url = `http://127.0.0.1:${port}`
  const page = await fetch(url)
  assert.equal(page.status, 200)
  assert.match(await page.text(), /PACC-BD/)
  assert.match(page.headers.get('content-security-policy') || '', /script-src 'self'/)
  const state = await fetch(`${url}/api/state`)
  assert.equal(state.status, 200)
  assert.deepEqual((await state.json()).queue, [])
  assert.equal((await fetch(`${url}/api/missing`)).status, 404)
  const badHostStatus = await new Promise<number>((resolve, reject) => {
    const req = httpRequest(url, { headers: { Host: 'example.com' } }, res => { res.resume(); resolve(res.statusCode || 0) })
    req.on('error', reject); req.end()
  })
  assert.equal(badHostStatus, 403)
  assert.equal((await fetch(`${url}/api/pause`, { method: 'POST', headers: { Origin: 'https://evil.example' } })).status, 403)
})
