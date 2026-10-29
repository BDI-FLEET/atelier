// The identity has one owner, the chrome: its styles.css writes the faces and the colours over its own fonts/. The shell's
// own layer writes neither.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
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
root('skin/frontend.jsx', `export const meta = { name: 'Skin', isChrome: true }\nexport function chrome() { return null }\n`)
root('skin/styles.css', `@import 'tailwindcss';\n`)

const server = await startServer(ROOT, { ATELIER_HOSTED: FILE })
after(async () => { await server.stop(); for (const d of [DIR, ROOT]) fs.rmSync(d, { recursive: true, force: true }) })
const ALEX = 'who=alex'
const get = (p, cookie = '') => fetch(server.base + p, { headers: { accept: 'text/html', cookie } })

const OURS = ['hosted.js', 'host-pages.jsx', 'frame.jsx', 'module-frame.jsx', 'frames.js', 'index.html']
const HEX = /#[0-9a-fA-F]{3,8}\b/
const IDENTITY_FILE = /identity\.css|atelier-identity-styles|_atelier\/fonts/

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
