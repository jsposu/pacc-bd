import express from 'express'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import type { Server } from 'node:http'
import { fetchCollection, parseCollectionId } from './collector.js'
import { Queue } from './queue.js'
import { migrateLegacyState } from './migration.js'
import { resolveOsuInputs } from './osu.js'
import { StableManager } from './stable.js'

export type ServerOptions = { port?: number; root: string; production?: boolean }
export async function startServer({ port = 4387, root, production = false }: ServerOptions): Promise<{ server: Server; port: number; queue: Queue }> {
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new Error('Invalid PORT.')
  const stateFile = path.join(process.env.PACC_BD_DATA_DIR || process.env.PANAMA_MAPS_DATA_DIR || process.env.AIMTHMUS_DATA_DIR || path.join(homedir(), '.pacc-bd'), 'state.json')
  if (!process.env.PACC_BD_DATA_DIR && !process.env.PANAMA_MAPS_DATA_DIR && !process.env.AIMTHMUS_DATA_DIR) {
    await migrateLegacyState(path.join(homedir(), '.panama-maps', 'state.json'), stateFile)
    await migrateLegacyState(path.join(homedir(), '.aimthmus', 'state.json'), stateFile)
  }
  const queue = await Queue.open(stateFile)
  const stable = new StableManager(queue)
  const app = express()
  app.disable('x-powered-by')
  let actualPort = port
  app.use((req, res, next) => {
    if (req.headers.host !== `127.0.0.1:${actualPort}` && req.headers.host !== `localhost:${actualPort}`) { res.status(403).json({ error: 'Invalid local host.' }); return }
    if (req.headers.origin && ![`http://127.0.0.1:${actualPort}`, `http://localhost:${actualPort}`].includes(req.headers.origin)) { res.status(403).json({ error: 'Cross-origin requests are not allowed.' }); return }
    if (production) res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' https://assets.ppy.sh data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'")
    next()
  })
  app.use('/api', express.json({ limit: '1mb' }))
  const route = (fn: (req: express.Request, res: express.Response) => Promise<void>) =>
    (req: express.Request, res: express.Response) => { void fn(req, res).catch((err: unknown) => { res.status(400).json({ error: err instanceof Error ? err.message : 'Request failed.' }) }) }

  app.get('/api/state', (_req, res) => res.json(queue.state))
  app.post('/api/collection', route(async (req, res) => {
    const id = parseCollectionId(req.body?.input)
    const collection = await fetchCollection(id)
    await queue.setCollection(collection)
    res.json(collection)
  }))
  let resolvingTournament = false
  app.post('/api/tournament', route(async (req, res) => {
    if (resolvingTournament) throw new Error('A tournament preview is already loading.')
    resolvingTournament = true
    try {
      const manifest = await resolveOsuInputs(req.body?.input, req.body?.numberKind)
      await queue.setTournament(manifest)
      res.json(manifest)
    } finally { resolvingTournament = false }
  }))
  app.post('/api/show', route(async (req, res) => { await queue.showCollection(Number(req.body?.id)); res.json({ ok: true }) }))
  app.post('/api/collections/clear', route(async (_req, res) => { await queue.clearCollections(); res.json({ ok: true }) }))
  app.get('/api/stable', route(async (_req, res) => { res.json(await stable.list()) }))
  app.get('/api/stable/collection', route(async (req, res) => { res.json(await stable.collection(String(req.query.name || ''))) }))
  app.get('/api/stable/search', route(async (req, res) => { res.json(await stable.search(String(req.query.q || ''))) }))
  app.post('/api/stable/connect', route(async (req, res) => { res.json(await stable.connect(req.body?.directory)) }))
  app.post('/api/stable/refresh', route(async (_req, res) => { res.json(await stable.list(true)) }))
  app.post('/api/stable/edit', route(async (req, res) => { res.json(await stable.edit(req.body || {})) }))
  app.post('/api/settings', route(async (req, res) => {
    if (typeof req.body?.directory !== 'string' || typeof req.body?.mirror !== 'string') throw new Error('Invalid settings.')
    await queue.settings({ directory: req.body.directory, mirror: req.body.mirror }); res.json({ ok: true })
  }))
  app.post('/api/enqueue', route(async (req, res) => { res.json({ added: await queue.enqueue(Number(req.body?.collectionId), req.body?.ids) }) }))
  app.post('/api/tournament/enqueue', route(async (req, res) => { res.json({ added: await queue.enqueueTournament(req.body?.ids) }) }))
  app.post('/api/pause', route(async (_req, res) => { await queue.pause(); res.json({ ok: true }) }))
  app.post('/api/resume', route(async (_req, res) => { await queue.resume(); res.json({ ok: true }) }))
  app.post('/api/cancel', route(async (_req, res) => { await queue.cancel(); res.json({ ok: true }) }))
  app.post('/api/retry', route(async (_req, res) => { await queue.retry(); res.json({ ok: true }) }))
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }))

  if (production) {
    const dist = path.join(root, 'dist')
    await fs.access(path.join(dist, 'index.html'))
    app.use(express.static(dist, { index: false }))
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')))
  } else {
    const { createServer: createViteServer } = await import('vite')
    const vite = await createViteServer({ root, server: { middlewareMode: true, hmr: false }, appType: 'custom' })
    app.use(vite.middlewares)
    app.get('*', route(async (req, res) => {
      const html = await vite.transformIndexHtml(req.originalUrl, await fs.readFile(path.join(root, 'index.html'), 'utf8'))
      res.type('html').send(html)
    }))
  }
  const server = await new Promise<Server>((resolve, reject) => {
    const listener = app.listen(port, '127.0.0.1', () => resolve(listener))
    listener.once('error', reject)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Could not determine the local server port.')
  actualPort = address.port
  console.log(`PACC-BD is ready at http://127.0.0.1:${actualPort}\nDownloads: ${queue.state.settings.directory}\nState: ${stateFile}`)
  return { server, port: actualPort, queue }
}
