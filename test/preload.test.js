// The document names up front every module the page will import, so the browser fetches them in one wave after the
// document instead of one import level per round trip: the shell's own imports, the chrome's bundle, and, for the host's
// page the address names, that page's bundle and its static imports, transitively (relative ones beside it, @atelier/kit
// through the import map), then every other page's the same way, so a click on a tab finds its code kept; each once, the
// addressed page's first; a module's address preloads every page's, nobody's sign-in page its own alone.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startServer } from './helpers.js'

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-preload-'))
const HOST = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-preload-host-'))
const put = (base) => (rel, text) => { fs.mkdirSync(path.dirname(path.join(base, rel)), { recursive: true }); fs.writeFileSync(path.join(base, rel), text) }
const root = put(ROOT), host = put(HOST)
root('skin/frontend.jsx', `export const meta = { name: 'Skin', isChrome: true }\nexport function chrome() { return null }\n`)
root('skin/kit.js', `export function Kit() { return null }\n`)
root('plain/frontend.jsx', `export const meta = { name: 'Plain' }\nexport default function M() { return <p>plain</p> }\n`)
host('pages/common.js', `export const word = 'hello'\n`)
host('pages/parts.jsx', `import { word } from './common.js'\nexport function Part() { return <b>{word}</b> }\n`)
host('pages/home.jsx', `import { Part } from './parts.js'\nexport default function Home() { return <Part /> }\n`)
host('pages/agent.jsx', `import { Kit } from '@atelier/kit'\nimport { Part } from './parts.js'\nexport default function Agent() { return <><Kit /><Part /></> }\n`)
host('pages/signin.jsx', `import { word } from './common.js'\nexport default function SignIn() { return <button>{word}</button> }\n`)
host('host.js', `export function person(req) { return /who=alex/.test(req.headers.cookie || '') ? { person: 'alex', name: 'Alex' } : null }
export const pages = { '/': { title: 'Home', file: './pages/home.jsx', icon: 'house' }, '/agent': { title: 'Agent', file: './pages/agent.jsx', sidebar: false }, signIn: { title: 'Sign in', file: './pages/signin.jsx' } }\n`)

const SHELL = ['/assets/chrome-resolve.js', '/assets/ws-bridge.js', '/assets/module-frame.js', '/assets/user-modules.js', '/assets/host-pages.js', '/assets/page-at.js', '/modules/global/skin/frontend.js']
const preloads = (html) => [...html.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map((m) => m[1])
let server
before(async () => { server = await startServer(ROOT, { ATELIER_HOSTED: path.join(HOST, 'host.js') }) })
after(async () => { await server?.stop(); for (const d of [ROOT, HOST]) fs.rmSync(d, { recursive: true, force: true }) })
const doc = async (p, cookie = 'who=alex') => (await fetch(server.base + p, { headers: { accept: 'text/html', cookie } })).text()

test("the document of a host's page preloads the shell's imports, the chrome's bundle, that page's imports first and every other page's, transitively and once", async () => {
  const got = preloads(await doc('/global/agent'))
  assert.deepEqual(got.slice(0, SHELL.length), SHELL)
  assert.deepEqual(got.slice(SHELL.length), ['/_atelier/pages/agent.js', '/modules/global/skin/kit.js', '/_atelier/pages/parts.js', '/_atelier/pages/common.js', '/_atelier/pages/home.js'])
  const home = preloads(await doc('/global/'))
  assert.deepEqual(home.slice(SHELL.length), ['/_atelier/pages/home.js', '/_atelier/pages/parts.js', '/_atelier/pages/common.js', '/_atelier/pages/agent.js', '/modules/global/skin/kit.js'])
})

test("a module's address and an unknown one preload the shell's, the chrome's and every page's", async () => {
  const pages = ['/_atelier/pages/home.js', '/_atelier/pages/parts.js', '/_atelier/pages/common.js', '/_atelier/pages/agent.js', '/modules/global/skin/kit.js']
  assert.deepEqual(preloads(await doc('/global/plain')), [...SHELL, ...pages])
  assert.deepEqual(preloads(await doc('/nowhere/at/all')), [...SHELL, ...pages])
})

test("nobody's document preloads the sign-in page's imports with the shell's and the chrome's", async () => {
  assert.deepEqual(preloads(await doc('/global/agent', '')), [...SHELL, '/_atelier/pages/signin.js', '/_atelier/pages/common.js'])
})

test('with hot reload off every preloaded address carries the asset tag', async () => {
  const kept = await startServer(ROOT, { ATELIER_HOSTED: path.join(HOST, 'host.js'), ATELIER_HOT_RELOAD: 'false' })
  try {
    const html = await (await fetch(kept.base + '/global/agent', { headers: { accept: 'text/html', cookie: 'who=alex' } })).text()
    const tag = JSON.parse(html.match(/window\.__ATELIER__ = (\{.*?\});/)[1]).assetTag
    const got = preloads(html)
    assert.equal(got.length, SHELL.length + 5)
    assert.deepEqual(got.filter((a) => !a.endsWith(`?v=${tag}`)), [])
  } finally { await kept.stop() }
})
