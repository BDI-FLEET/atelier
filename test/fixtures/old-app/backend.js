import fs from 'node:fs'
import path from 'node:path'

export default {
  mountRoutes(router, ctx) {
    const suspended = ctx.suspendable()
    router.get('/', (req, res) => res.json({ page: 'root' }))
    router.get('/suspendable', (req, res) => res.json({ returned: suspended === undefined ? 'undefined' : suspended }))
    const file = path.join(ctx.dataDir, 'items.json')
    const read = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return [] } }
    const write = (items) => fs.writeFileSync(file, JSON.stringify(items))
    router.get('/items', (req, res) => res.json(read()))
    router.post('/items', async (req, res) => {
      const { text } = await req.json()
      write([...read(), { id: Date.now(), text, by: req.user.name }])
      ctx.broadcast({ type: 'changed' })
      res.json({ ok: true })
    })
    router.get('/me', (req, res) => res.json({ user: req.user, caller: ctx.caller }))
    router.get('/files/*', (req, res) => res.json({ path: req.params['*'] }))
      .all('/ping', (req, res) => res.json({ method: req.method }))
    router.get('/*', (req, res) => req.params['*'] ? res.json({ page: req.params['*'] }) : res.json({ error: 'not found' }, 404))
    router.options('/*', (req, res) => { res.writeHead(204, { 'access-control-allow-methods': 'GET, POST' }); res.end() })
  },
}
