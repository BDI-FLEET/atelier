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
