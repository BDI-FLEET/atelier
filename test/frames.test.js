// Atelier behind a host: module.json, a process per backend, frames on their own origin with their runtime (frame.jsx),
// the caller.
// Each test is titled with the rule it protects. The instance is made in tmp here.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { pathToFileURL } from 'node:url'
import { registerHooks } from 'node:module'
import { startServer, sleep } from './helpers.js'
import { ROOT as SHELL } from './ours.js'
import { getJsx } from '../build.js'

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-frames-'))
const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(ROOT, rel)), { recursive: true }); fs.writeFileSync(path.join(ROOT, rel), text) }

put('plain/frontend.jsx', `export const meta = { name: 'Plain', icon: 'leaf' }\nexport default function M() { return null }\n`)
put('plain/backend.js', `export default { mountRoutes(r, ctx) {
  r.get('/who', (q, s) => s.json({ pid: process.pid, caller: ctx.caller, qid: ctx.qualifiedId }))
  r.post('/crash', (q, s) => { s.json({ ok: true }); setTimeout(() => { throw new Error('down on purpose') }, 10) })
} }\n`)
put('declared/module.json', JSON.stringify({ name: 'Declared', icon: 'star', colour: 'red' }))
put('declared/frontend.jsx', `export const meta = { name: 'from meta' }\nexport default function M() { return null }\n`)
put('other/frontend.jsx', `export default function M() { return null }\n`)
put('other/backend.js', `export default { mountRoutes(r) { r.get('/ping', (q, s) => s.json({ pid: process.pid })) } }\n`)
put('host.js', `export function person(req) { return { person: 'alex', name: 'Alex' } }\n`)

let server
before(async () => { server = await startServer(ROOT) })
after(async () => { await server?.stop(); fs.rmSync(ROOT, { recursive: true, force: true }) })

// A request with a given Host (fetch may not set one): the frame hosts are names on this same port.
function get(port, host, p, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, headers: { host: `${host}:${port}`, ...headers } }, (res) => {
      let body = ''
      res.on('data', (c) => { body += c })
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }))
    })
    req.on('error', reject)
    req.end()
  })
}
const boot = async () => JSON.parse((await (await fetch(server.base + '/')).text()).match(/window\.__ATELIER__ = (\{.*?\});/)[1])
const entry = (b, id) => b.user.workspaces.find((w) => w.id === 'global').modules.find((m) => m.id === id)

test('a module without module.json runs on its meta, and a module.json names its module and reports an unknown key', async () => {
  const b = await boot()
  assert.deepEqual(entry(b, 'plain').meta, { name: 'Plain', icon: 'leaf' })   // its meta, untouched
  const r = await fetch(server.base + '/api/global/plain/who')
  assert.equal(r.status, 200)
  assert.equal((await r.json()).qid, 'global/plain')
  // …and a module.json, where there is one, names the module; an unknown key is ignored and reported.
  assert.equal(entry(b, 'declared').meta.name, 'Declared')
  assert.equal(entry(b, 'declared').meta.icon, 'star')
  assert.match(server.output(), /declared\/module\.json: unknown key "colour"/)
})

test('a crashing backend takes down its own process and nothing else', async () => {
  const before = await (await fetch(server.base + '/api/global/other/ping')).json()
  const first = await (await fetch(server.base + '/api/global/plain/who')).json()
  assert.notEqual(first.pid, process.pid)
  assert.notEqual(first.pid, before.pid)                         // each backend is its own process
  await fetch(server.base + '/api/global/plain/crash', { method: 'POST' })
  await sleep(200)
  const down = await fetch(server.base + '/api/global/plain/who')
  assert.equal(down.status, 500)
  assert.match((await down.json()).message, /down on purpose/)
  const still = await (await fetch(server.base + '/api/global/other/ping')).json()
  assert.equal(still.pid, before.pid)                            // the other module never noticed
  let again
  for (let i = 0; i < 40; i++) {                                  // restarted after 1 s
    const r = await fetch(server.base + '/api/global/plain/who')
    if (r.status === 200) { again = await r.json(); break }
    await sleep(100)
  }
  assert.ok(again, 'the crashed backend came back')
  assert.notEqual(again.pid, first.pid)
})

test('a module is served on its own origin and nothing of the shell is served there', async () => {
  const p = server.port
  const b = await boot()
  assert.equal(b.frames['global/plain'], `http://plain.localhost:${p}`)
  const doc = await get(p, 'plain.localhost', '/global/plain')
  assert.equal(doc.status, 200)
  assert.match(doc.body, /\/_frame\/frame\.js/)
  assert.equal((await get(p, 'plain.localhost', '/api/global/plain/who')).status, 200)
  assert.equal((await get(p, 'plain.localhost', '/modules/global/plain/frontend.js')).status, 200)
  for (const path of ['/', '/assets/client.js', '/_atelier/whoami', '/global/other',
    '/api/global/other/ping', '/modules/global/other/frontend.js', '/modules/global/declared/frontend.js']) {
    assert.equal((await get(p, 'plain.localhost', path)).status, 404, path)
  }
  assert.equal((await get(p, 'nothere.localhost', '/global/nothere')).status, 404)
})

test("with hot reload off a frame's document addresses its runtime and the module's code by the asset tag and names them up front, and a runtime file asked with the tag is kept with its relative imports tagged", async () => {
  const kept = await startServer(ROOT, { ATELIER_HOT_RELOAD: 'false' })
  try {
    const p = kept.port
    const tag = JSON.parse((await (await fetch(kept.base + '/')).text()).match(/window\.__ATELIER__ = (\{.*?\});/)[1]).assetTag
    assert.match(tag, /^[0-9a-f]{12}$/)
    const doc = (await get(p, 'plain.localhost', '/global/plain')).body
    for (const s of ['/_frame/react.js', '/_frame/react-dom.js']) assert.ok(doc.includes(`<script src="${s}?v=${tag}"></script>`), s)
    assert.ok(doc.includes(`<script type="module" src="/_frame/frame.js?v=${tag}"></script>`), 'the frame runs by the tag')
    for (const s of ['/_frame/frame.js', '/_frame/ws-bridge.js', '/modules/global/plain/frontend.js']) assert.ok(doc.includes(`<link rel="modulepreload" href="${s}?v=${tag}">`), `${s} named up front`)
    assert.equal(JSON.parse(doc.match(/window\.__ATELIER_FRAME__ = (\{.*?\});/)[1]).assetTag, tag, 'the frame knows the tag for the module code it imports')
    const frame = await get(p, 'plain.localhost', `/_frame/frame.js?v=${tag}`)
    assert.equal(frame.headers['cache-control'], 'public, max-age=31536000, immutable')
    assert.ok(frame.body.includes(`./ws-bridge.js?v=${tag}`), 'the frame imports the bridge by the tag')
    assert.equal((await get(p, 'plain.localhost', `/_frame/react.js?v=${tag}`)).headers['cache-control'], 'public, max-age=31536000, immutable')
    assert.equal((await get(p, 'plain.localhost', '/_frame/react.js')).headers['cache-control'], 'no-cache', 'asked without the tag it is revalidated, as before')
  } finally { await kept.stop() }
})

test('with hot reload on a frame\'s document addresses its runtime bare and names nothing up front', async () => {
  const doc = (await get(server.port, 'plain.localhost', '/global/plain')).body
  assert.ok(doc.includes('<script src="/_frame/react.js"></script>'))
  assert.equal(doc.includes('modulepreload'), false)
})

test('the page and a frame each load what their script imports beside it: the one real-time channel, on their own origin', async () => {
  const p = server.port
  const importsOf = (code) => [...code.matchAll(/\bfrom\s*['"]\.\/([^'"]+)['"]/g)].map((m) => m[1])
  const client = await (await fetch(`${server.base}/assets/client.js`)).text()
  assert.ok(importsOf(client).includes('ws-bridge.js'))
  for (const f of importsOf(client)) assert.equal((await fetch(`${server.base}/assets/${f}`)).status, 200, f)
  const frame = await get(p, 'plain.localhost', '/_frame/frame.js')
  assert.equal(frame.status, 200)
  assert.ok(importsOf(frame.body).includes('ws-bridge.js'))
  for (const f of importsOf(frame.body)) assert.equal((await get(p, 'plain.localhost', `/_frame/${f}`)).status, 200, f)
})

test('a frame cannot be embedded by another page, and its bridge answers only this instance', async () => {
  const p = server.port
  const mine = await get(p, 'plain.localhost', `/global/plain?atelier-parent=${encodeURIComponent(`http://127.0.0.1:${p}`)}`)
  assert.match(mine.headers['content-security-policy'], new RegExp(`^frame-ancestors http://localhost:${p} http://127\\.0\\.0\\.1:${p}`))
  assert.match(mine.body, new RegExp(`"parent":"http://127\\.0\\.0\\.1:${p}"`))
  const foreign = await get(p, 'plain.localhost', `/global/plain?atelier-parent=${encodeURIComponent('https://evil.example')}`)
  assert.match(foreign.body, /"parent":null/)
  assert.doesNotMatch(foreign.headers['content-security-policy'], /evil/)
})

test('the caller header is ignored without a host and is ctx.caller under one', async () => {
  const spoof = Buffer.from(JSON.stringify({ person: 'mallory' })).toString('base64url')
  const plain = await (await fetch(server.base + '/api/global/plain/who', { headers: { 'x-atelier-caller': spoof } })).json()
  assert.equal(plain.caller, null)
  // With the host switch on, the header is the host's word, and it is what ctx.caller reads.
  const hosted = await startServer(ROOT, { ATELIER_HOSTED: './host.js' })
  try {
    const alex = Buffer.from(JSON.stringify({ person: 'alex', name: 'Alex' })).toString('base64url')
    const r = await (await fetch(hosted.base + '/api/global/plain/who', { headers: { 'x-atelier-caller': alex } })).json()
    assert.deepEqual(r.caller, { person: 'alex', name: 'Alex' })
  } finally { await hosted.stop() }
})

test("a host's pages are its own, shown in the chrome, not frames", async () => {
  // the host's file and its pages live outside the instance: they are the host's, not modules
  const HOST = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-host-'))
  const hput = (rel, text) => { fs.mkdirSync(path.dirname(path.join(HOST, rel)), { recursive: true }); fs.writeFileSync(path.join(HOST, rel), text) }
  hput('pages/home.jsx', `export default function Home({ user }) { return <h1>Hello, {user.name}.</h1> }\n`)
  hput('pages/activate.jsx', `export default function Activate() { return <p>activate</p> }\n`)
  hput('pages/signin.jsx', `export default function SignIn({ signedIn }) { return <button onClick={signedIn}>Sign in</button> }\n`)
  hput('host.js', `export function person(req) { return /who=alex/.test(req.headers.cookie || '') ? { person: 'alex', name: 'Alex', logout: '/out' } : null }
export const pages = { '/': { title: 'Home', file: './pages/home.jsx', icon: 'house' }, '/activate': { title: 'Activate', file: './pages/activate.jsx', sidebar: false }, signIn: { title: 'Sign in', file: './pages/signin.jsx' } }\n`)
  const hosted = await startServer(ROOT, { ATELIER_HOSTED: path.join(HOST, 'host.js') })
  const bootOf = (html) => JSON.parse(html.match(/window\.__ATELIER__ = (\{.*?\});<\/script>/)[1])
  try {
    // nobody: the host's sign-in page at the asked path, and nothing about any module
    const out = await fetch(hosted.base + '/activate', { headers: { accept: 'text/html' } })
    assert.equal(out.status, 401)
    const outHtml = await out.text()
    assert.deepEqual(bootOf(outHtml).signIn, { title: 'Sign in', src: '/_atelier/pages/signin.js' })
    assert.equal(bootOf(outHtml).signedOut, true)
    assert.doesNotMatch(JSON.stringify(bootOf(outHtml)), /plain|declared|other/)
    // its code loads before any session, transformed like a module frontend
    const js = await fetch(hosted.base + '/_atelier/pages/signin.js')
    assert.equal(js.status, 200)
    assert.match(await js.text(), /React\.createElement/)
    // Alex: the host's pages by path, shown in the page's content area; none of them is a frame; Sign out is the host's address
    const cookie = { cookie: 'who=alex' }
    const b = bootOf(await (await fetch(hosted.base + '/activate', { headers: cookie })).text())
    assert.deepEqual(b.pages.map((p) => p.path).sort(), ['/', '/activate'])
    assert.deepEqual(b.pages.find((p) => p.path === '/activate'), { path: '/activate', title: 'Activate', src: '/_atelier/pages/activate.js', sidebar: false })
    // a page is a sidebar entry unless it says not, with its icon; the client lists them before the apps (host-pages.jsx pageEntries)
    assert.deepEqual(b.pages.find((p) => p.path === '/'), { path: '/', title: 'Home', src: '/_atelier/pages/home.js', icon: 'house' })
    assert.equal(b.user.logout, '/out')
    assert.ok(Object.keys(b.frames).every((q) => /^global\//.test(q)) && !Object.values(b.frames).some((o) => /home|activate|signin/.test(o)))
    // no module origin serves a page; and the caller a module reads is who, nothing else (no logout address)
    assert.equal((await get(hosted.port, 'plain.localhost', '/_atelier/pages/home.js', cookie)).status, 404)
    const who = await (await fetch(hosted.base + '/api/global/plain/who', { headers: cookie })).json()
    assert.deepEqual(who.caller, { person: 'alex', name: 'Alex' })
  } finally { await hosted.stop(); fs.rmSync(HOST, { recursive: true, force: true }) }
})

// frame.jsx as the browser gets it, run in a stand-in window opened at `address` inside a page at PAGE, on the origin of a
// stand-in server that answers every request with `status`: in node the module's import fails as it does when refused. With
// `loadsFirst` the module loads at the opening, then a save asks the frame to load it again and that import fails.
// → { went: the addresses the frame replaced itself with, drawn: what it rendered, asked: the requests it made, at: its address }
const PAGE = 'https://atelier.example'
let opened = 0
let moduleLoads = false
registerHooks({ resolve: (specifier, context, next) => moduleLoads && specifier.startsWith('/modules/') && context.parentURL?.startsWith('data:')
  ? { url: 'data:text/javascript,export default function M() { return null }', shortCircuit: true } : next(specifier, context) })
async function openFrame(address, status, { loadsFirst = false } = {}) {
  const asked = []
  const standIn = http.createServer((req, res) => { asked.push({ url: req.url, cache: req.headers['cache-control'] }); res.writeHead(status); res.end('closed') })
  await new Promise((resolve) => standIn.listen(0, '127.0.0.1', resolve))
  let at = new URL(address, `http://127.0.0.1:${standIn.address().port}`)
  const went = [], drawn = []
  const nothing = () => {}
  try {
    globalThis.window = {
      __ATELIER_FRAME__: { qid: 'global/plain', workspace: 'global', id: 'plain', parent: PAGE, title: 'Plain', assetTag: null },
      parent: { postMessage: nothing },
      location: { get href() { return at.href }, get pathname() { return at.pathname }, get search() { return at.search }, get hash() { return at.hash },
        get protocol() { return at.protocol }, get host() { return at.host }, replace: (u) => went.push(new URL(u, at).href) },
      history: { replaceState: (_s, _t, u) => { at = new URL(u, at) } },
      addEventListener: nothing, dispatchEvent: nothing,
    }
    globalThis.document = { documentElement: { classList: { toggle: nothing }, style: {}, toggleAttribute: nothing }, getElementById: (id) => (id === 'root' ? { toggleAttribute: nothing } : null), head: {}, addEventListener: nothing, title: 'Plain' }
    globalThis.MutationObserver = class { observe() {} }
    const sockets = []
    globalThis.WebSocket = class { readyState = 0; constructor() { sockets.push(this) } }
    globalThis.React = { Component: class { constructor(props) { this.props = props } }, createElement: (type, props, ...kids) => ({ type, props, kids }) }
    globalThis.ReactDOM = { createRoot: () => ({ render: (el) => drawn.push(el) }) }
    const code = (await getJsx(path.join(SHELL, 'frame.jsx'))).content.replace(/(from\s+['"])(\.\/[^'"]+)(['"])/g, (_, a, spec, z) => a + pathToFileURL(path.join(SHELL, spec)).href + z)
    moduleLoads = loadsFirst
    await import(`data:text/javascript,${encodeURIComponent(`${code}\n// opened ${++opened}`)}`)
    const settled = async (seen) => { for (let i = 0; i < 200 && !went.length && drawn.length === seen; i++) await sleep(10) }
    await settled(0)
    if (loadsFirst) {
      moduleLoads = false
      sockets[0].onmessage({ data: JSON.stringify({ topic: 'shell', type: 'reload', moduleId: 'global/plain' }) })
      await settled(drawn.length)
    }
    await sleep(50)
    return { went, drawn, asked, at: at.href }
  } finally { standIn.closeAllConnections(); await new Promise((resolve) => standIn.close(resolve)) }
}
const failure = (drawn) => drawn.map((el) => el.kids?.[0]).find((t) => typeof t === 'string' && t.startsWith('global/plain · failed to load\n\n'))

test("a frame whose module is refused 401 (its handle gone) asks its own page once and goes there again with the page's origin, for a new pass", async () => {
  const { went, drawn, asked, at } = await openFrame(`/global/plain/n/1?tab=2&atelier-parent=${encodeURIComponent(PAGE)}`, 401)
  assert.deepEqual(asked, [{ url: '/global/plain/n/1?tab=2', cache: 'no-cache' }])
  assert.deepEqual(went, [new URL(`/global/plain/n/1?tab=2&atelier-parent=${encodeURIComponent(PAGE)}`, at).href])
  assert.deepEqual(drawn, [])
})

test('a frame that came back from a pass and whose module is refused shows the failure, and takes no other pass', async () => {
  const { went, drawn, asked, at } = await openFrame(`/global/plain?atelier-parent=${encodeURIComponent(PAGE)}&atelier-entered=1`, 401)
  assert.equal(new URL(at).search, '', 'the module sees neither mark')
  assert.deepEqual([went, asked], [[], []])
  assert.ok(failure(drawn), 'the failure is shown')
})

test("a frame whose module fails to load for any other reason than a 401 shows today's words", async () => {
  const { went, drawn, asked } = await openFrame(`/global/plain?atelier-parent=${encodeURIComponent(PAGE)}`, 503)
  assert.equal(asked.length, 1)
  assert.deepEqual(went, [])
  assert.match(failure(drawn) ?? '', /Failed to resolve module specifier "\/modules\/global\/plain\/frontend\.js"/)
})

test('a frame that came back from a pass and has loaded its module since takes a new pass when a later import is refused 401', async () => {
  const { went, drawn, asked, at } = await openFrame(`/global/plain?atelier-parent=${encodeURIComponent(PAGE)}&atelier-entered=1`, 401, { loadsFirst: true })
  assert.equal(drawn.length, 1, 'the module was drawn once')
  assert.equal(failure(drawn), undefined)
  assert.deepEqual(asked, [{ url: '/global/plain', cache: 'no-cache' }])
  assert.deepEqual(went, [new URL(`/global/plain?atelier-parent=${encodeURIComponent(PAGE)}`, at).href])
})
