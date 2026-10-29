// The identity: identity.css, the one stylesheet of ours that gives the shell its faces and colours, served by hosted.js
// with its fonts beside it and named by index.html right after the chrome's stylesheet, in every document a host draws.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startServer } from './helpers.js'
import { ROOT as SHELL, read } from './ours.js'

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-identity-'))
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-identity-root-'))
const put = (base) => (rel, text) => { fs.mkdirSync(path.dirname(path.join(base, rel)), { recursive: true }); fs.writeFileSync(path.join(base, rel), text); return path.join(base, rel) }
const host = put(DIR), root = put(ROOT)
host('pages/home.jsx', 'export default () => null\n')
host('pages/signin.jsx', 'export default () => null\n')
const FILE = host('host.js', `export function person(req) { return /who=alex/.test(req.headers.cookie || '') ? { person: 'alex', name: 'Alex' } : null }
export const pages = { '/': { title: 'Home', file: './pages/home.jsx' }, signIn: { title: 'Sign in', file: './pages/signin.jsx' } }\n`)
root('skin/frontend.jsx', `export const meta = { name: 'Skin', isChrome: true }\nexport function chrome() { return null }\n`)
root('skin/styles.css', `@import 'tailwindcss';\n`)

const server = await startServer(ROOT, { ATELIER_HOSTED: FILE })
after(async () => { await server.stop(); for (const d of [DIR, ROOT]) fs.rmSync(d, { recursive: true, force: true }) })
const get = (p, cookie = '') => fetch(server.base + p, { headers: { accept: 'text/html', cookie } })

const IDENTITY = 'identity.css'
const TOKENS = ['--font-sans', '--font-serif', '--font-mono', '--ink', '--panel', '--sheet', '--paper', '--muted', '--caps', '--live', '--live-bright', '--line', '--edge',
  ...['950', '900', '800', '700', '600', '500', '400', '300', '200', '100', '50'].map((n) => `--color-zinc-${n}`), '--color-lime-400', '--color-lime-500']
const FACES = ['Inter', 'Cormorant Garamond', 'JetBrains Mono']
const AFTER_CHROME = /<link id="atelier-chrome-styles"[^>]*>\s*<link id="atelier-identity-styles" rel="stylesheet" href="\/_atelier\/identity\.css">/

test('the signed-out and the signed-in document both carry atelier-identity-styles right after atelier-chrome-styles', async () => {
  const out = await get('/global/'), signedIn = await get('/global/', 'who=alex')
  assert.equal(out.status, 401)
  assert.equal(signedIn.status, 200)
  assert.match(await out.text(), AFTER_CHROME)
  assert.match(await signedIn.text(), AFTER_CHROME)
})

test('GET /_atelier/identity.css answers text/css to anyone with every token the identity names, --live gold, and a @font-face per face', async () => {
  const res = await get('/_atelier/identity.css')
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type'), /^text\/css\b/)
  assert.equal(res.headers.get('cache-control'), 'no-store')
  const css = await res.text()
  assert.deepEqual(TOKENS.filter((t) => !new RegExp(`${t}:`).test(css)), [])
  assert.match(css, /--live:\s*#e6c178;/)
  const faces = [...css.matchAll(/@font-face\s*\{[^}]*font-family:\s*'([^']+)'/g)].map((m) => m[1])
  assert.deepEqual(FACES.filter((f) => !faces.includes(f)), [])
})

test('every url() in identity.css names a file under fonts/ that GET answers as font/woff2 kept for a long time, and nothing else there is served', async () => {
  const urls = [...read(IDENTITY).matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map((m) => m[1])
  assert.ok(urls.length >= FACES.length)
  for (const u of urls) {
    assert.match(u, /^fonts\/[a-z0-9-]+\.woff2$/)
    assert.ok(fs.existsSync(path.join(SHELL, u)), `${u} is vendored`)
    const res = await get(`/_atelier/${u}`)
    assert.equal(res.status, 200, u)
    assert.equal(res.headers.get('content-type'), 'font/woff2')
    assert.match(res.headers.get('cache-control'), /max-age=\d{7,}/)
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), fs.readFileSync(path.join(SHELL, u)))
  }
  for (const p of ['/_atelier/fonts/OFL-inter.txt', '/_atelier/fonts/missing.woff2', '/_atelier/fonts/..%2Fhosted.js']) assert.equal((await get(p, 'who=alex')).status, 404, p)
})

test("identity.css is the only file of the shell's own layer that writes a hex colour", () => {
  const HEX = /#[0-9a-fA-F]{3,8}\b/
  assert.match(read(IDENTITY), HEX)
  assert.deepEqual(['hosted.js', 'host-pages.jsx', 'index.html'].filter((f) => HEX.test(read(f))), [])
})
