// The host's handed(req, person): what the host answers up front for the page the document draws, carried by the
// document as window.__ATELIER__.handed (null when it throws); a host that exports none hands nothing; nobody's document
// carries nothing.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadHost } from '../hosted.js'
import { startServer } from './helpers.js'

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-handed-'))
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-handed-root-'))
const put = (base) => (rel, text) => { fs.mkdirSync(path.dirname(path.join(base, rel)), { recursive: true }); fs.writeFileSync(path.join(base, rel), text); return path.join(base, rel) }
const host = put(DIR), root = put(ROOT)
after(() => { for (const d of [DIR, ROOT]) fs.rmSync(d, { recursive: true, force: true }) })
const quiet = async (fn) => { const log = console.log, error = console.error; console.log = () => {}; console.error = () => {}; try { return await fn() } finally { console.log = log; console.error = error } }
host('pages/home.jsx', 'export default () => null\n')
host('pages/signin.jsx', 'export default () => null\n')
const FILE = host('host.js', `export function person(req) { return /who=alex/.test(req.headers.cookie || '') ? { person: 'alex', name: 'Alex' } : null }
export async function handed(req, person) { if (/boom/.test(req.headers.cookie || '')) throw new Error('boom'); return { home: { for: person.person, at: req.url } } }
export const pages = { '/': { title: 'Home', file: './pages/home.jsx' }, signIn: { title: 'Sign in', file: './pages/signin.jsx' } }\n`)

test("handed(req, person) is asked with the person the host named for that request; its throw is null; a host without it hands nothing", async () => {
  const h = await quiet(() => loadHost(FILE, DIR, {}))
  const req = { url: '/global/', headers: { cookie: 'who=alex' } }
  assert.equal(await h.gate(req, { workspaces: [] }, null) !== null, true)
  assert.deepEqual(await h.handed(req), { home: { for: 'alex', at: '/global/' } })
  const boom = { url: '/global/', headers: { cookie: 'who=alex; boom' } }
  await h.gate(boom, { workspaces: [] }, null)
  assert.equal(await quiet(() => h.handed(boom)), null)
  const none = await quiet(() => loadHost(host('none.js', `export function person() { return { person: 'alex' } }\n`), DIR, {}))
  assert.equal(await none.handed(req), null)
})

test("the document carries what the host handed for this request, null when it threw, and nobody's document carries nothing", async () => {
  root('skin/frontend.jsx', `export const meta = { name: 'Skin', isChrome: true }\nexport function chrome() { return null }\n`)
  const server = await startServer(ROOT, { ATELIER_HOSTED: FILE })
  try {
    const boot = async (cookie) => {
      const html = await (await fetch(server.base + '/global/', { headers: { accept: 'text/html', cookie } })).text()
      return JSON.parse(html.match(/window\.__ATELIER__ = (\{.*?\});/)[1])
    }
    assert.deepEqual((await boot('who=alex')).handed, { home: { for: 'alex', at: '/global/' } })
    assert.equal((await boot('who=alex; boom')).handed, null)
    assert.equal('handed' in await boot(''), false)
  } finally { await server.stop() }
})
