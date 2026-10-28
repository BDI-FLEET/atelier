// frames.js on its own: what server.js hands createFrames, and what it answers for an origin, a request and a channel.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createFrames } from '../frames.js'

const mod = (id, workspace = 'global') => ({ id, workspace, qualifiedId: `${workspace}/${id}`, hasFrontend: true })
const MODULES = [mod('notes'), mod('board', 'team')]

function frames(over = {}) {
  return createFrames({
    domain: null, port: 4321, baseUrl: 'http://localhost:4321', hostDir: '.', observe: false,
    remotes: false, bounded: () => false, addressOf: (p) => p, assetTag: () => null,
    getModules: () => MODULES, userModuleSet: (user) => new Set(user?.qids || []),
    ...over,
  })
}
const req = (host) => ({ headers: { host } })

test("a module's origin is its label under localhost on the instance's port, or under frameDomain with baseUrl's scheme and port", () => {
  assert.equal(frames().originFor(MODULES[0]), 'http://notes.localhost:4321')
  assert.equal(frames().originFor(MODULES[1]), 'http://board.team.localhost:4321')
  const named = frames({ domain: 'apps.example', baseUrl: 'https://atelier.example:8443' })
  assert.equal(named.originFor(MODULES[1]), 'https://board.team.apps.example:8443')
  assert.deepEqual(frames().origins({ qids: ['global/notes'] }), { 'global/notes': 'http://notes.localhost:4321' })
})

test("a request on the page's own host is left to the page: serve answers false and the channel is the gate's user with no module", async () => {
  const f = frames()
  assert.equal(await f.serve(req('localhost:4321'), null, new URL('http://localhost:4321/')), false)
  assert.deepEqual(await f.channel(req('localhost:4321'), async () => ({ id: 'alex' })), { user: { id: 'alex' }, frameMod: null })
})

test("a frame host's channel carries its own module, a remote one only where the host's sidebar names that origin, and no user for a module not the person's", async () => {
  const alex = { id: 'alex', qids: ['global/notes'], workspaces: [{ id: 'global', modules: [{ id: 'far', origin: 'http://far.localhost:4321', meta: { name: 'Far' } }] }] }
  const gate = async () => alex
  const local = await frames().channel(req('notes.localhost:4321'), gate)
  assert.equal(local.frameMod.qualifiedId, 'global/notes')
  assert.equal(local.user, alex)
  assert.equal(await frames().channel(req('far.localhost:4321'), gate), null)
  const remote = await frames({ remotes: true }).channel(req('far.localhost:4321'), gate)
  assert.deepEqual(remote.frameMod, { qualifiedId: 'global/far', workspace: 'global', id: 'far', remote: true, name: 'Far' })
  const fenced = await frames({ bounded: () => true }).channel(req('board.team.localhost:4321'), gate)
  assert.equal(fenced.frameMod.qualifiedId, 'team/board')
  assert.equal(fenced.user, null)
})

test("a remote module listed in a company's workspace is framed on its origin as the app alone in the global workspace: its frame page at /global/<id>, its channel its global qid, the person's", async () => {
  const alex = { id: 'alex', qids: ['halden/far'], workspaces: [{ id: 'halden', modules: [{ id: 'far', origin: 'http://far.localhost:4321', meta: { name: 'Far' } }] }] }
  const f = frames({ remotes: true, bounded: () => true, getMetaByQId: async () => ({}), buildDefaultUser: () => null,
    authenticateRequest: async () => alex, resolveChromeForQid: () => null })
  const remote = await f.channel(req('far.localhost:4321'), async () => alex)
  assert.deepEqual(remote, { user: alex, frameMod: { qualifiedId: 'global/far', workspace: 'global', id: 'far', remote: true, name: 'Far' } })
  const page = async (p) => {
    const res = { writeHead(status) { this.status = status }, end(body) { this.body = body } }
    await f.serve({ ...req('far.localhost:4321'), method: 'GET' }, res, new URL(`http://far.localhost:4321${p}`))
    return [res.status, /window\.__ATELIER_FRAME__ = (\{.*?\});/.exec(res.body)?.[1]]
  }
  assert.deepEqual(await page('/global/far/n/1'), [200, JSON.stringify({ qid: 'global/far', workspace: 'global', id: 'far', parent: null, title: 'Far', observe: false, assetTag: null })])
  assert.deepEqual(await page('/halden/far'), [404, undefined])
})
