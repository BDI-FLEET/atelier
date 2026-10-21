// Atelier behind a host: module.json, a process per backend, frames on their own origin with their runtime (frame.jsx),
// the caller.
// Each test is titled with the rule it protects. The instance is made in tmp here.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { startServer, sleep } from './helpers.js'

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
