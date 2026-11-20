// The router a module's backend is given is one (router.js), wherever the backend runs: in the shell's own process
// (the gate's routes), in a backend's own process behind the shell (backend-host.js), and in a computer's serving
// sandbox (module-serve.js). Its body reader is one too, so its rules hold in all three. In the serving sandbox a
// request's caller and, on a tool call, the call's id are read off the computer's headers and taken off the request.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from './helpers.js'
import { Readable } from 'node:stream'
import { CALLER_HEADER, CALL_HEADER, createRouter } from '../router.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MODULE_SERVE = path.resolve(HERE, '..', 'module-serve.js')

const csv = { 'content-type': 'text/csv' }
const json = { 'content-type': 'application/json' }
const ownPlain = { 'content-type': 'text/plain', 'sec-fetch-site': 'same-origin' }

async function viaFetch(url, headers, body) {
  const r = await fetch(url, { method: 'POST', headers, body })
  return { status: r.status, body: await r.json() }
}

function viaSocket(socketPath, p, headers, body, method = 'POST') {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath, method, path: p, headers: { ...headers, ...(body === null ? {} : { 'content-length': Buffer.byteLength(body) }) } }, (res) => {
      let text = ''
      res.on('data', (d) => { text += d })
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }))
    })
    req.on('error', reject)
    req.end(body ?? undefined)
  })
}

async function moduleServe() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-router-'))
  const mod = path.join(dir, 'echo')
  fs.mkdirSync(mod)
  fs.writeFileSync(path.join(mod, 'module.json'), JSON.stringify({ name: 'echo', agent: { tools: ['heard'] }, config: ['ECHO_KEY'] }))
  // what a route and a tool read of the request: its body, ctx.caller, ctx.call and the computer's headers left on it
  fs.writeFileSync(path.join(mod, 'backend.js'), `const left = (q) => Object.keys(q.headers).filter((h) => h.startsWith('x-atelier-'))
export default {
  mountRoutes(router, ctx) {
    router.post('/echo', async (q, s) => s.json({ echoed: await q.json(), caller: ctx.caller, call: ctx.call, left: left(q) }))
  },
  tools(ctx) {
    return { heard: { description: 'what the call carried', input: { type: 'object' }, async run() { return { caller: ctx.caller, call: ctx.call } } } }
  },
}
`)
  const socket = path.join(dir, 'echo.sock')
  const p = spawn(process.execPath, [MODULE_SERVE, mod, '--socket', socket], { stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`module-serve did not come up:\n${out}`)), 15000)
    const seen = (d) => { out += d; if (/ · up · /.test(out)) { clearTimeout(t); resolve() } }
    p.stdout.on('data', seen)
    p.stderr.on('data', seen)
    p.on('exit', () => { clearTimeout(t); reject(new Error(`module-serve ended:\n${out}`)) })
  })
  return {
    post: (headers, body, p = '/api/global/echo/echo') => viaSocket(socket, p, headers, body),
    get: (p) => viaSocket(socket, p, {}, null, 'GET'),
    stop: () => { p.removeAllListeners('exit'); p.kill('SIGTERM'); fs.rmSync(dir, { recursive: true, force: true }) },
  }
}

test('req.json() reads a body only when it says content-type application/json, else 415, in all three routers; a serving sandbox alone reads one its own page sent as text/plain', async () => {
  const shell = await startServer(path.join(HERE, 'fixtures', 'ws-basic'))
  const gated = await startServer(path.join(HERE, 'fixtures', 'http-acl'), { ATELIER_AUTH: 'gate' })
  const sandbox = await moduleServe()
  try {
    const admin = { 'x-test-user': 'admin' }
    const routers = {
      'a backend in its own process': (h, b) => viaFetch(`${shell.base}/api/global/beta/echo`, h, b),
      'the shell, for the gate\'s own routes': (h, b) => viaFetch(`${gated.base}/api/global/gate/echo`, { ...admin, ...h }, b),
      'a computer\'s serving sandbox': (h, b) => sandbox.post(h, b),
    }
    for (const [where, post] of Object.entries(routers)) {
      const refused = await post(csv, '{"a":1}')
      assert.equal(refused.status, 415, where)
      assert.match(refused.body.error, /content-type application\/json/, where)
      // only a serving sandbox reads JSON its own page sent without saying so; the shell and the gate never do
      const plain = await post(ownPlain, '{"a":1}')
      assert.equal(plain.status, where === 'a computer\'s serving sandbox' ? 200 : 415, where)
      const read = await post(json, '{"a":1}')
      assert.equal(read.status, 200, where)
      assert.deepEqual(read.body.echoed, { a: 1 }, where)
    }
  } finally {
    sandbox.stop()
    await gated.stop()
    await shell.stop()
  }
})

test("in a computer's serving sandbox a tool's run reads the call's id in ctx.call and a route reads null, both headers taken off the request", async () => {
  const sandbox = await moduleServe()
  try {
    const caller = { persona: 'persona:b1', name: 'Bayard', sandbox: 'sandbox:5d', chat: 'chat:c2' }
    const computer = { ...json, [CALLER_HEADER]: Buffer.from(JSON.stringify(caller)).toString('base64url'), [CALL_HEADER]: 'tc-0123abcd' }
    const tool = await sandbox.post(computer, '{}', '/api/global/echo/tools/heard')
    assert.deepEqual([tool.status, tool.body.result], [200, { caller, call: 'tc-0123abcd' }])
    const route = await sandbox.post(computer, '{"a":1}')
    assert.deepEqual([route.status, route.body.call, route.body.left], [200, null, []])
  } finally {
    sandbox.stop()
  }
})

test("what a serving sandbox offers names its tools, its teaching and the config keys module.json declares", async () => {
  const sandbox = await moduleServe()
  try {
    const offered = await sandbox.get('/api/global/echo/tools')
    assert.deepEqual([offered.status, offered.body.tools.map((t) => t.name), offered.body.teaching, offered.body.config], [200, ['heard'], null, ['ECHO_KEY']])
  } finally {
    sandbox.stop()
  }
})

// the old host's router (its spike's matrix, ported): every method, all(), a trailing /* whose rest is req.params['*'] (the
// bare parent too), HEAD served by the GET route, first match wins, and a bad path encoding a 400 the router answers
const fakeReq = (method, url) => Object.assign(Readable.from([]), { method, url, headers: {} })
function fakeRes() {
  const res = { status: null, body: '', writableEnded: false }
  res.writeHead = (s) => { res.status = s }
  res.end = (b = '') => { res.body += b; res.writableEnded = true }
  return res
}

test("the router an app is given has head, options and all, a trailing /* whose rest is req.params['*'], HEAD served by the GET route, the first match winning, as the old host's did", async () => {
  const r = createRouter()
  const api = r.scope('/api/global/m')
  const h = (tag) => (req, res) => res.json({ tag, method: req.method, params: req.params })
  const chained = api.get('', h('root'))
  assert.equal(chained, api, 'each method returns the router, as the old one did')
  api.get('/items/:id', h('item'))
  api.get('/s/:id/space.js', h('spacejs'))
  api.get('/s/:id/api/*', h('spaceapi'))
  api.get('/s/:id/*', h('spacestatic'))
  api.options('/*', h('cors'))
  api.post('/upload', h('upload'))
  api.head('/probe', h('probe'))
  api.get('/star*name', h('literal'))
  api.all('/*', h('catchall'))
  const t = async (method, p, tag, params) => {
    const res = fakeRes()
    assert.equal(await r.handle(fakeReq(method, `/api/global/m${p}`), res), true, `${method} ${p}: no match`)
    const got = JSON.parse(res.body)
    assert.equal(got.tag, tag, `${method} ${p}`)
    if (params) assert.deepEqual(got.params, params, `${method} ${p}`)
  }
  await t('GET', '', 'root')
  await t('HEAD', '', 'root')
  await t('GET', '/items/42', 'item', { id: '42' })
  await t('GET', '/items/a%2Fb', 'item', { id: 'a/b' })
  await t('GET', '/s/abc/space.js', 'spacejs', { id: 'abc' })
  await t('GET', '/s/abc/api/db/query', 'spaceapi', { id: 'abc', '*': 'db/query' })
  await t('GET', '/s/abc/api', 'spaceapi', { id: 'abc', '*': '' })
  await t('GET', '/s/abc', 'spacestatic', { id: 'abc', '*': '' })
  await t('GET', '/s/abc/', 'spacestatic', { id: 'abc', '*': '' })
  await t('GET', '/s/abc/deep/er/still/index.html', 'spacestatic', { id: 'abc', '*': 'deep/er/still/index.html' })
  await t('OPTIONS', '/anything/at/all', 'cors', { '*': 'anything/at/all' })
  await t('POST', '/upload', 'upload')
  await t('HEAD', '/probe', 'probe')
  await t('GET', '/probe', 'catchall', { '*': 'probe' })
  await t('GET', '/star*name', 'literal')
  await t('GET', '/starXname', 'catchall', { '*': 'starXname' })
  await t('PUT', '/whatever/deep', 'catchall', { '*': 'whatever/deep' })
  await t('PROPFIND', '/dav/x', 'catchall')
  await t('DELETE', '', 'catchall', { '*': '' })
  await t('GET', '/items', 'catchall')
  const only = createRouter()
  only.scope('/api/global/m').get('/only', h('only'))
  assert.equal(await only.handle(fakeReq('GET', '/api/global/m/nope'), fakeRes()), false)
  assert.equal(await only.handle(fakeReq('POST', '/api/global/m/only'), fakeRes()), false)
  const bad = fakeRes()
  assert.equal(await only.handle(fakeReq('GET', '/api/global/m/only'), fakeRes()), true)
  const r2 = createRouter()
  r2.scope('/api/global/m').get('/items/:id', h('item'))
  assert.equal(await r2.handle(fakeReq('GET', '/api/global/m/items/%E0%A4%A'), bad), true)
  assert.equal(bad.status, 400)
})

test("every route answers its address with and without one trailing slash, as the old host's did, the root too, before a /* registered after it; a /* keeps its rest", async () => {
  const h = (tag) => (req, res) => res.json({ tag, params: req.params })
  const asked = async (router, method, p) => {
    const res = fakeRes()
    return await router.handle(fakeReq(method, `/api/global/m${p}`), res) ? JSON.parse(res.body || '{}') : null
  }
  for (const root of ['/', '']) {
    const r = createRouter()
    r.scope('/api/global/m').get(root, h('root')).get('/items/:id', h('item')).get('/listed/', h('listed')).get('/*', h('rest')).delete('/*', h('rest'))
    for (const p of ['', '/']) {
      assert.equal((await asked(r, 'GET', p))?.tag, 'root', `GET '${p}' under a root registered as '${root}'`)
      assert.equal((await asked(r, 'HEAD', p))?.tag, 'root', `HEAD '${p}' under a root registered as '${root}'`)
    }
    assert.deepEqual(await asked(r, 'GET', '//'), { tag: 'rest', params: { '*': '/' } })
    assert.deepEqual(await asked(r, 'GET', '/real/rest'), { tag: 'rest', params: { '*': 'real/rest' } })
    assert.deepEqual(await asked(r, 'DELETE', '/'), { tag: 'rest', params: { '*': '' } })
    assert.deepEqual(await asked(r, 'GET', '/items/42'), { tag: 'item', params: { id: '42' } })
    assert.deepEqual(await asked(r, 'GET', '/items/42/'), { tag: 'item', params: { id: '42' } })
    assert.deepEqual(await asked(r, 'HEAD', '/items/42/'), { tag: 'item', params: { id: '42' } })
    assert.deepEqual(await asked(r, 'GET', '/items/42//'), { tag: 'rest', params: { '*': 'items/42//' } })
    for (const p of ['/listed', '/listed/']) assert.equal((await asked(r, 'GET', p))?.tag, 'listed', p)
    assert.deepEqual(await asked(r, 'GET', '/listed//'), { tag: 'rest', params: { '*': 'listed//' } })
  }
  const only = createRouter()
  only.scope('/api/global/m').get('/', h('root')).get('/only', h('only'))
  assert.equal((await asked(only, 'GET', '/only'))?.tag, 'only')
  assert.equal((await asked(only, 'GET', '/only/'))?.tag, 'only')
  assert.equal(await asked(only, 'GET', '/only//'), null)
  assert.equal(await asked(only, 'GET', '/onlyx'), null)
  assert.equal(await asked(only, 'GET', '//'), null)
  const restFirst = createRouter()
  restFirst.scope('/api/global/m').get('/*', h('rest')).get('/', h('root'))
  assert.deepEqual(await asked(restFirst, 'GET', '/'), { tag: 'rest', params: { '*': '' } })
})
