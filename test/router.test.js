// The router a module's backend is given is one (router.js), wherever the backend runs: in the shell's own process
// (the gate's routes), in a backend's own process behind the shell (backend-host.js), and in a computer's serving
// sandbox (module-serve.js). Its body reader is one too, so its rules hold in all three.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from './helpers.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MODULE_SERVE = path.resolve(HERE, '..', 'module-serve.js')

const csv = { 'content-type': 'text/csv' }
const json = { 'content-type': 'application/json' }

async function viaFetch(url, headers, body) {
  const r = await fetch(url, { method: 'POST', headers, body })
  return { status: r.status, body: await r.json() }
}

function viaSocket(socketPath, p, headers, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath, method: 'POST', path: p, headers: { ...headers, 'content-length': Buffer.byteLength(body) } }, (res) => {
      let text = ''
      res.on('data', (d) => { text += d })
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }))
    })
    req.on('error', reject)
    req.end(body)
  })
}

async function moduleServe() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-router-'))
  const mod = path.join(dir, 'echo')
  fs.mkdirSync(mod)
  fs.writeFileSync(path.join(mod, 'backend.js'),
    "export default { mountRoutes(router) { router.post('/echo', async (q, s) => s.json({ echoed: await q.json() })) } }\n")
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
    post: (headers, body) => viaSocket(socket, '/api/global/echo/echo', headers, body),
    stop: () => { p.removeAllListeners('exit'); p.kill('SIGTERM'); fs.rmSync(dir, { recursive: true, force: true }) },
  }
}

test('req.json() reads a body only when it says content-type application/json, else 415, in all three routers', async () => {
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
