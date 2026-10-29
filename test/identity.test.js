// The identity has one owner, the chrome: its styles.css writes the faces and the colours over its own fonts/. The shell's
// own layer writes neither, and it serves the chrome's fonts wherever the chrome's stylesheet is served: to a module's
// frame at /_frame/fonts/<file>, and to the signed-out document beside the chrome's stylesheet and kit.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { startServer } from './helpers.js'
import { ROOT as SHELL, read } from './ours.js'

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-identity-'))
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-identity-root-'))
const put = (base) => (rel, body) => { fs.mkdirSync(path.dirname(path.join(base, rel)), { recursive: true }); fs.writeFileSync(path.join(base, rel), body); return path.join(base, rel) }
const host = put(DIR), root = put(ROOT)
host('pages/home.jsx', 'export default () => null\n')
host('pages/signin.jsx', 'export default () => null\n')
const FILE = host('host.js', `export function person(req) { return /who=alex/.test(req.headers.cookie || '') ? { person: 'alex', name: 'Alex' } : null }
export const pages = { '/': { title: 'Home', file: './pages/home.jsx' }, signIn: { title: 'Sign in', file: './pages/signin.jsx' } }\n`)
const FONT = Buffer.from([0x77, 0x4f, 0x46, 0x32, 1, 2, 3, 4])
root('skin/frontend.jsx', `export const meta = { name: 'Skin', isChrome: true }\nexport function chrome() { return null }\n`)
root('skin/styles.css', `@import 'tailwindcss';\n@font-face { font-family: 'Face'; src: url(fonts/face.woff2) format('woff2'); }\n`)
root('skin/fonts/face.woff2', FONT)
root('skin/fonts/OFL-face.txt', 'the licence\n')
root('zbare/frontend.jsx', `export const meta = { name: 'Bare', isChrome: true }\nexport function chrome() { return null }\n`)
root('zbare/styles.css', `@import 'tailwindcss';\n:root { --bare-chrome: 1; }\n`)
root('plain/frontend.jsx', `export default function M() { return null }\n`)
root('pinned/frontend.jsx', `export const meta = { chrome: 'zbare' }\nexport default function M() { return null }\n`)

const server = await startServer(ROOT, { ATELIER_HOSTED: FILE })
after(async () => { await server.stop(); for (const d of [DIR, ROOT]) fs.rmSync(d, { recursive: true, force: true }) })
const ALEX = 'who=alex'
const get = (p, cookie = '') => fetch(server.base + p, { headers: { accept: 'text/html', cookie } })
// A request to a module's own origin: a name on this same port, which fetch does not let a test set as the Host.
const frameGet = (name, p, method = 'GET') => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port: server.port, path: p, method, headers: { host: `${name}.localhost:${server.port}`, cookie: ALEX } }, (res) => {
    const chunks = []
    res.on('data', (c) => chunks.push(c))
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }))
  })
  req.on('error', reject)
  req.end()
})

const OURS = ['hosted.js', 'host-pages.jsx', 'frame.jsx', 'module-frame.jsx', 'frames.js', 'index.html']
const HEX = /#[0-9a-fA-F]{3,8}\b/
const IDENTITY_FILE = /identity\.css|atelier-identity-styles|_atelier\/fonts/
const KEPT = 'public, max-age=31536000, immutable'

test("the shell's own layer writes no hex colour and names no identity file, and the shell carries no identity.css and no fonts/", () => {
  assert.deepEqual(OURS.filter((f) => HEX.test(read(f))), [])
  assert.deepEqual(OURS.filter((f) => IDENTITY_FILE.test(read(f))), [])
  assert.deepEqual(['identity.css', 'fonts'].filter((f) => fs.existsSync(path.join(SHELL, f))), [])
})

test('the signed-out and the signed-in document carry the chrome stylesheet and no atelier-identity-styles link', async () => {
  const out = await get('/global/'), signedIn = await get('/global/', ALEX)
  assert.equal(out.status, 401)
  assert.equal(signedIn.status, 200)
  for (const html of [await out.text(), await signedIn.text()]) {
    assert.match(html, /<link id="atelier-chrome-styles" rel="stylesheet" href="\/modules\/global\/skin\/styles\.css[^"]*">/)
    assert.doesNotMatch(html, /atelier-identity-styles/)
  }
})

test('GET /_atelier/identity.css is no stylesheet: nobody gets the 401 of not signed in and a person the 404 of an unknown /_atelier/ path', async () => {
  const out = await get('/_atelier/identity.css'), signedIn = await get('/_atelier/identity.css', ALEX)
  assert.equal(out.status, 401)
  assert.match(out.headers.get('content-type'), /^text\/plain\b/)
  assert.equal(await out.text(), 'not signed in')
  assert.equal(signedIn.status, 404)
  assert.equal(await signedIn.text(), 'Not found')
  assert.equal((await get('/_atelier/fonts/inter-v20-latin.woff2', ALEX)).status, 404)
})

test("every url() under fonts/ in a frame's chrome stylesheet answers at /_frame/fonts/ as font/woff2 kept for a year, a HEAD without its body", async () => {
  const doc = await frameGet('plain', '/global/plain')
  assert.equal(doc.status, 200)
  assert.match(doc.body.toString(), /<link id="atelier-frame-styles" rel="stylesheet" href="\/_frame\/styles\.css[^"]*">/)
  const css = await frameGet('plain', '/_frame/styles.css')
  const urls = [...css.body.toString().matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map((m) => m[1])
  assert.deepEqual(urls, ['fonts/face.woff2'])
  const font = await frameGet('plain', `/_frame/${urls[0]}`)
  assert.equal(font.status, 200)
  assert.equal(font.headers['content-type'], 'font/woff2')
  assert.equal(font.headers['cache-control'], KEPT)
  assert.equal(Number(font.headers['content-length']), FONT.length)
  assert.deepEqual(font.body, FONT)
  const head = await frameGet('plain', `/_frame/${urls[0]}`, 'HEAD')
  assert.equal(head.status, 200)
  assert.equal(head.headers['content-type'], 'font/woff2')
  assert.equal(head.body.length, 0)
})

test("a frame's name that is not a woff2 under its chrome's fonts/ answers 404: a licence text, a missing file, a path that climbs", async () => {
  for (const p of ['/_frame/fonts/OFL-face.txt', '/_frame/fonts/missing.woff2', '/_frame/fonts/..%2Fstyles.css']) {
    assert.equal((await frameGet('plain', p)).status, 404, p)
  }
})

test("a frame whose chrome carries no fonts/ answers 404 for a font the other chrome carries", async () => {
  const css = await frameGet('pinned', '/_frame/styles.css')
  assert.match(css.body.toString(), /--bare-chrome/, 'the pinned module is framed under the chrome with no fonts/')
  assert.equal((await frameGet('pinned', '/_frame/fonts/face.woff2')).status, 404)
})

test("the signed-out document gets the default chrome's woff2 fonts as it gets its stylesheet, and nothing else of the chrome's fonts/", async () => {
  const font = await get('/modules/global/skin/fonts/face.woff2')
  assert.equal(font.status, 200)
  assert.equal(font.headers.get('content-type'), 'font/woff2')
  assert.deepEqual(Buffer.from(await font.arrayBuffer()), FONT)
  assert.equal((await get('/modules/global/skin/fonts/OFL-face.txt')).status, 401)
  assert.equal((await get('/modules/global/zbare/fonts/face.woff2')).status, 401)
})
