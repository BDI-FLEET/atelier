// An app written as the old host's skill taught every agent to write one (fixtures/old-app: its module.json, its
// backend.js, its frontend.jsx) answers unchanged in a computer's serving sandbox (module-serve.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CALLER_HEADER } from '../router.js'
import { unfoundImports, unfoundSaid } from '../backend-imports.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MODULE_SERVE = path.resolve(HERE, '..', 'module-serve.js')
const OLD_APP = path.join(HERE, 'fixtures', 'old-app')
const API = '/api/global/old-app'

const asCaller = (caller) => ({ [CALLER_HEADER]: Buffer.from(JSON.stringify(caller)).toString('base64url') })
const person = { person: 'person:a1', name: 'Ana', via: { kind: 'person' } }

async function serve(dir = OLD_APP, env = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-old-app-'))
  const socket = path.join(tmp, 'app.sock')
  const p = spawn(process.execPath, [MODULE_SERVE, dir, '--socket', socket, '--data', path.join(tmp, 'data')], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } })
  let out = ''
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`module-serve did not come up:\n${out}`)), 15000)
    const seen = (d) => { out += d; if (/ · up · /.test(out)) { clearTimeout(t); resolve() } }
    p.stdout.on('data', seen)
    p.stderr.on('data', seen)
    p.on('exit', () => { clearTimeout(t); reject(new Error(`module-serve ended:\n${out}`)) })
  })
  const request = (method, p, headers = {}, body = null) => new Promise((resolve, reject) => {
    const req = http.request({ socketPath: socket, method, path: p, headers: { ...headers, ...(body === null ? {} : { 'content-length': Buffer.byteLength(body) }) } }, (res) => {
      let text = ''
      res.on('data', (d) => { text += d })
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text, json: () => JSON.parse(text) }))
    })
    req.on('error', reject)
    req.end(body ?? undefined)
  })
  return {
    request,
    out: () => out,
    stop: () => { p.removeAllListeners('exit'); p.kill('SIGTERM'); fs.rmSync(tmp, { recursive: true, force: true }) },
  }
}

test("req.user is { id, name } of the person ctx.caller names, null with no caller and null for an agent's caller: the old skill's example writes by req.user.name", async () => {
  const app = await serve()
  try {
    const me = await app.request('GET', `${API}/me`, asCaller(person))
    assert.deepEqual([me.status, me.json()], [200, { user: { id: 'person:a1', name: 'Ana' }, caller: person }])
    const nobody = await app.request('GET', `${API}/me`)
    assert.deepEqual(nobody.json(), { user: null, caller: null })
    const agent = { persona: 'persona:b1', name: 'Bayard', sandbox: 'sandbox:5d', chat: 'chat:c2' }
    assert.deepEqual((await app.request('GET', `${API}/me`, asCaller(agent))).json(), { user: null, caller: agent })
    const added = await app.request('POST', `${API}/items`, { ...asCaller(person), 'content-type': 'application/json' }, '{"text":"milk"}')
    assert.equal(added.status, 200, added.text)
    assert.deepEqual((await app.request('GET', `${API}/items`, asCaller(person))).json().map(({ text, by }) => ({ text, by })), [{ text: 'milk', by: 'Ana' }])
  } finally {
    app.stop()
  }
})

test("its routes by options, all and a trailing /* answer, and a HEAD is answered by its GET route without a body", async () => {
  const app = await serve()
  try {
    assert.deepEqual((await app.request('GET', `${API}/files/a/b%20c.txt`)).json(), { path: 'a/b c.txt' })
    assert.deepEqual((await app.request('DELETE', `${API}/ping`, { 'content-type': 'application/json' })).json(), { method: 'DELETE' })
    const pre = await app.request('OPTIONS', `${API}/items`)
    assert.deepEqual([pre.status, pre.headers['access-control-allow-methods']], [204, 'GET, POST'])
    const head = await app.request('HEAD', `${API}/items`)
    assert.deepEqual([head.status, head.headers['content-type'], head.text], [200, 'application/json', ''])
  } finally {
    app.stop()
  }
})

test("ctx.suspendable() is a function that returns nothing, as the old host's did: an app that calls it at its start comes up", async () => {
  const app = await serve()
  try {
    assert.deepEqual((await app.request('GET', `${API}/suspendable`)).json(), { returned: 'undefined' })
  } finally {
    app.stop()
  }
})

test("a relative import without its extension is served: a file as the file it names, a folder by a redirect to its index; two files it could name are neither, and said", async () => {
  const app = await serve()
  const at = (p) => app.request('GET', `/modules/global/old-app/${p}`)
  try {
    const util = await at('util'), utilJs = await at('util.js')
    assert.deepEqual([util.status, util.headers['content-type'], util.text], [200, utilJs.headers['content-type'], utilJs.text])
    const lib = await at('lib')
    assert.deepEqual([lib.status, lib.headers.location], [302, 'lib/index.js'])
    assert.equal((await at('lib/index.js')).status, 200)
    const part = await at('lib/part')
    assert.deepEqual([part.status, part.text], [200, (await at('lib/part.js')).text])
    assert.equal((await at('both')).status, 404)
    assert.match(app.out(), /frontend\.jsx imports \.\/both: both\.js and both\.jsx/)
    assert.equal((await at('backend')).status, 404)
  } finally {
    app.stop()
  }
})

test("a write from the app's own page whose body is JSON without saying so (text/plain, or no content type) is read by req.json(), as the old host read it; from anywhere else, or a form, or a body that is not JSON, it is refused 415 before any route runs", async () => {
  const app = await serve()
  const post = (headers, body = '{"text":"eggs"}') => app.request('POST', `${API}/items`, { ...asCaller(person), ...headers }, body)
  const own = { 'sec-fetch-site': 'same-origin' }
  try {
    assert.equal((await post({ ...own, 'content-type': 'text/plain;charset=UTF-8' })).status, 200)
    assert.equal((await post(own)).status, 200)
    assert.deepEqual((await app.request('GET', `${API}/items`)).json().map(({ text, by }) => ({ text, by })), [{ text: 'eggs', by: 'Ana' }, { text: 'eggs', by: 'Ana' }])
    const refused = {
      'another site': { 'sec-fetch-site': 'cross-site', 'content-type': 'text/plain' },
      'another app of the same site': { 'sec-fetch-site': 'same-site', 'content-type': 'text/plain' },
      'a page the browser does not name': { 'content-type': 'text/plain' },
      'an Origin and no sec-fetch-site': { origin: 'https://m-x.frames.example', 'content-type': 'text/plain' },
      'another site, no content type': { 'sec-fetch-site': 'cross-site' },
      'a form': { ...own, 'content-type': 'application/x-www-form-urlencoded' },
      'a multipart form': { ...own, 'content-type': 'multipart/form-data; boundary=x' },
    }
    for (const [why, headers] of Object.entries(refused)) assert.equal((await post(headers)).status, 415, why)
    assert.equal((await post({ ...own, 'content-type': 'text/plain' }, 'eggs')).status, 415, 'not JSON')
    assert.equal((await app.request('GET', `${API}/items`)).json().length, 2)
  } finally {
    app.stop()
  }
})

// a backend as the old host's bundler took it: imports without their extension, of a folder, beside the ones Node finds
function bundledBackend() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-old-backend-'))
  const write = (f, text) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), text) }
  write('backend.js', `import { createRequire } from 'node:module'
import { open } from './db'
import {
  rows,
} from './lib'
import { ok } from './ok.js'
// import { gone } from './gone'
/*
import { old } from './db'
*/
const require = createRequire(import.meta.url)
const db = require('./db')
export default { mountRoutes(router) { router.get('/x', (q, s) => s.json({ open: open(), rows: rows(), ok })) } }
`)
  write('db.js', 'export const open = () => true\n')
  write('ok.js', 'export const ok = 1\n')
  write('lib/index.js', "export { rows } from './rows'\n")
  write('lib/rows.mjs', 'export const rows = () => []\n')
  write('node_modules/pkg/index.js', "import './inner'\n")
  return dir
}

test("each import of the backend Node does not find as written is named by file and line with what to write, a folder's by its index, transitively; a require, a comment and a full name are not", () => {
  const dir = bundledBackend()
  try {
    assert.deepEqual(unfoundImports(dir), [
      { file: 'backend.js', line: 2, spec: './db', fix: './db.js' },
      { file: 'backend.js', line: 3, spec: './lib', fix: './lib/index.js' },
      { file: 'lib/index.js', line: 1, spec: './rows', fix: './rows.mjs' },
    ])
    assert.equal(unfoundSaid(unfoundImports(dir)[1]), "backend.js:3 imports './lib', which Node does not find as written: write './lib/index.js'")
    assert.deepEqual(unfoundImports(OLD_APP), [])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("a backend with such an import does not start: its process ends at once, each import said by file and line with what to write", async () => {
  const dir = bundledBackend()
  try {
    await assert.rejects(serve(dir), (err) => {
      assert.match(err.message, /module-serve ended/)
      assert.match(err.message, /backend\.js:2 imports '\.\/db', which Node does not find as written: write '\.\/db\.js'/)
      assert.match(err.message, /lib\/index\.js:1 imports '\.\/rows'.*write '\.\/rows\.mjs'/)
      return true
    })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
