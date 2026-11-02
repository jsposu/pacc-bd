import { startServer } from './app.js'

const port = Number(process.env.PORT || 4387)
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT.')
await startServer({ port, root: process.cwd(), production: process.env.PACC_BD_PRODUCTION === '1' })
