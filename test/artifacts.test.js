// atelier artifacts adopt (artifacts.js, through the ops client in ops.js) — exercised through the real CLI against an
// in-process fake of the host's op routes: the op names the computer and the path inside its drive, nothing goes into
// it, the computer's lines are printed as remote: lines and its code is the exit.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'cli.js')
const SECRET = 'sess_test_9a1b7c3d5e2f8a4b6c0d1e3f5a7b9c2d'
const OP = 'op-7a8b9c0d'
const SAID = ['Trip plan · 3 versions · http://portal.test/artifacts/0123456789abcdef01234567', 'done · 1 adopted · 0 already']

// The fake host: the op asked is kept; its stream says the computer's lines and ends with `code`.
async function fakeHost(code) {
  const asked = [], ins = []
  const server = http.createServer(async (req, res) => {
    const chunks = []
    for await (const c of req) chunks.push(c)
    const raw = Buffer.concat(chunks).toString('utf8')
    const body = raw ? JSON.parse(raw) : {}
    const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }
    if (req.headers.authorization !== `Session ${SECRET}`) return send(401, { refused: 'the session is not valid; sign in again' })
    if (req.method === 'POST' && req.url === '/api/ops') { asked.push(body); return send(201, { op: OP, computer: body.computer }) }
    if (req.method === 'GET' && req.url === `/api/ops/${OP}/stream`) {
      res.writeHead(200, { 'content-type': 'application/x-ndjson' })
      for (const f of [{ started: true }, ...SAID.map((line) => ({ line })), { done: true, code }]) res.write(JSON.stringify(f) + '\n')
      return res.end()
    }
    if (req.method === 'POST' && req.url === `/api/ops/${OP}/in`) { ins.push(body); return send(200, { ok: true }) }
    send(404, { error: 'no such route' })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  return { url: `http://127.0.0.1:${server.address().port}`, asked, ins, close: () => new Promise((r) => { server.closeAllConnections(); server.close(r) }) }
}

function signedIn(host) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-artifacts-'))
  fs.mkdirSync(path.join(home, '.config', 'atelier'), { recursive: true, mode: 0o700 })
  fs.writeFileSync(path.join(home, '.config', 'atelier', 'credentials'), JSON.stringify({
    [host]: { session: SECRET, expires: '2099-10-31T12:00:00.000Z', person: { id: 'person:7f3a2c', name: 'Alex' } },
  }), { mode: 0o600 })
  return home
}

function cli(home, args) {
  const env = { ...process.env, HOME: home }
  for (const k of ['ATELIER_HOST', 'XDG_CONFIG_HOME', 'ATELIER_SOCKET', 'ATELIER_SANDBOX']) delete env[k]
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [CLI, ...args], { cwd: home, env })
    let out = '', err = ''
    c.stdout.on('data', (d) => { out += d })
    c.stderr.on('data', (d) => { err += d })
    c.on('close', (code) => resolve({ code, out, err }))
  })
}

test('artifacts adopt asks the host for one op on the path inside the computer\'s drive, sends nothing into it, prints the computer\'s lines as remote: lines and exits with its code', async () => {
  for (const code of [0, 1]) {
    const host = await fakeHost(code), home = signedIn(host.url)
    try {
      const r = await cli(home, ['artifacts', 'adopt', 'k1:/archive/artifacts', '--host', host.url])
      assert.equal(r.code, code, r.err)
      assert.deepEqual(host.asked.map((a) => [a.computer, a.op]), [['k1', { verb: 'artifacts-adopt', path: 'archive/artifacts' }]])
      assert.deepEqual(host.ins, [], 'nothing goes into the op')
      assert.deepEqual(r.err.split('\n').filter((l) => l.startsWith('remote: ')), SAID.map((l) => `remote: ${l}`))
    } finally { await host.close(); fs.rmSync(home, { recursive: true, force: true }) }
  }
})

test('artifacts adopt refuses before asking the host a drive side that is not computer:/path or leaves the drive, a word missing, and any sub-verb but adopt, with exit 2', async () => {
  const host = await fakeHost(0), home = signedIn(host.url)
  try {
    for (const [args, said] of [
      [['adopt', 'archive/artifacts'], 'is not computer:/path'], [['adopt', 'k1:/archive/../..'], 'the path stays inside the drive'],
      [['adopt'], 'adopt takes <computer>:/<path>'], [['publish', 'k1:/x'], 'artifacts publish? adopt'], [[], 'artifacts what? adopt']]) {
      const r = await cli(home, ['artifacts', ...args, '--host', host.url])
      assert.equal(r.code, 2, `${args.join(' ')}: ${r.err}`)
      assert.ok(r.err.includes(said), `${args.join(' ')}: ${r.err}`)
    }
    assert.deepEqual(host.asked, [])
  } finally { await host.close(); fs.rmSync(home, { recursive: true, force: true }) }
})
