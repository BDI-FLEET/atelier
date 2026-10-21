// atelier data push (data.js, through the ops client in ops.js) — exercised through the real CLI against an in-process
// fake of the host's three op routes: the tar of data/ goes in pieces of at most PIECE (limits.js), each read from the
// file when it goes, and the end names the size and the sha256 of what went. data.js and files.js read no file whole:
// both take their pieces and hashes from ops.js.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PIECE } from '../limits.js'
import { codeLines } from './ours.js'

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'cli.js')
const SECRET = 'sess_test_3d9b7f1a5c2e8d4b6f0a1c3e5d7b9f2a'
const OP = 'op-4e5f6a7b'

// The fake host: one op that takes pieces where they say they start and, at the end, says done.
async function fakeHost() {
  const pieces = [], ends = []
  let stream = null, taken = Buffer.alloc(0)
  const say = (f) => stream?.write(JSON.stringify(f) + '\n')
  const server = http.createServer(async (req, res) => {
    const chunks = []
    for await (const c of req) chunks.push(c)
    const raw = Buffer.concat(chunks).toString('utf8')
    const body = raw ? JSON.parse(raw) : {}
    const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }
    if (req.headers.authorization !== `Session ${SECRET}`) return send(401, { refused: 'the session is not valid; sign in again' })
    if (req.method === 'POST' && req.url === '/api/ops') return send(201, { op: OP, computer: 'k1' })
    if (req.method === 'GET' && req.url === `/api/ops/${OP}/stream`) {
      res.writeHead(200, { 'content-type': 'application/x-ndjson' })
      stream = res
      say({ started: true })
      return
    }
    if (req.method === 'POST' && req.url === `/api/ops/${OP}/in`) {
      if (typeof body.put === 'string') {
        const bytes = Buffer.from(body.data, 'base64')
        pieces.push({ put: body.put, at: body.at, length: bytes.length })
        taken = Buffer.concat([taken.subarray(0, body.at), bytes])
        return send(200, { at: body.at + bytes.length })
      }
      if (body.end) {
        ends.push(body)
        send(200, { ok: true })
        say({ line: 'data replaced · notes restarted' })
        say({ done: true, code: 0 })
        return
      }
    }
    send(404, { error: 'no such route' })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  return { url: `http://127.0.0.1:${server.address().port}`, pieces, ends, taken: () => taken, close: () => new Promise((r) => { server.closeAllConnections(); server.close(r) }) }
}

/* A signed-in home and a module folder whose remote `atelier` names the fake host's computer k1 and its app notes. */
function moduleAt(host) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-data-'))
  const dir = path.join(home, '.config', 'atelier')
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  fs.writeFileSync(path.join(dir, 'credentials'), JSON.stringify({
    [host]: { session: SECRET, expires: '2099-10-31T12:00:00.000Z', person: { id: 'person:7f3a2c', name: 'Alex' } },
  }), { mode: 0o600 })
  const mod = path.join(home, 'notes')
  fs.mkdirSync(mod)
  fs.writeFileSync(path.join(mod, 'module.json'), JSON.stringify({ name: 'notes' }))
  const git = (...a) => execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@localhost', ...a], { cwd: mod, stdio: 'ignore' })
  git('init', '-q'); git('remote', 'add', 'atelier', `${host}/git/k1/notes.git`)
  return { home, mod }
}

test('data push sends the tar of data/ in pieces of at most PIECE from where each starts, and its end names the size and sha256 of the bytes that went', async () => {
  const host = await fakeHost()
  try {
    const { home, mod } = moduleAt(host.url)
    const content = crypto.randomBytes(2 * PIECE + PIECE / 2)
    fs.mkdirSync(path.join(mod, 'data'))
    fs.writeFileSync(path.join(mod, 'data', 'notes.db'), content)
    const env = { ...process.env, HOME: home }
    delete env.ATELIER_HOST; delete env.ATELIER_SOCKET; delete env.ATELIER_SANDBOX; delete env.XDG_CONFIG_HOME
    const p = spawn(process.execPath, [CLI, 'data', 'push', '-r', 'atelier', '--confirm', 'notes'], { cwd: mod, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let err = ''
    p.stderr.on('data', (d) => { err += d })
    const code = await new Promise((r) => p.on('close', r))
    assert.equal(code, 0, err)
    const taken = host.taken()
    assert.ok(host.pieces.length > 2, `${host.pieces.length} pieces`)
    assert.ok(host.pieces.every((x) => x.put === 'data' && x.length > 0 && x.length <= PIECE))
    assert.deepEqual(host.pieces.map((x) => x.at), host.pieces.map((_, i) => i * PIECE))
    assert.deepEqual(host.ends, [{ end: true, size: taken.length, sha256: crypto.createHash('sha256').update(taken).digest('hex') }])
    const back = fs.mkdtempSync(path.join(home, 'back-'))
    fs.writeFileSync(path.join(back, 'data.tar'), taken)
    execFileSync('tar', ['-xf', 'data.tar'], { cwd: back })
    assert.ok(content.equals(fs.readFileSync(path.join(back, 'data', 'notes.db'))), 'the bytes that went are data/ as it is here')
    assert.match(err, /remote: data replaced · notes restarted/)
  } finally { await host.close() }
})

test('data.js and files.js read no file whole, as their pieces and hashes come from the readers ops.js shares', () => {
  const whole = ['data.js', 'files.js'].flatMap((f) => codeLines(f).filter(({ line }) => /readFileSync|\.digest\(/.test(line)).map(({ at }) => `${f}:${at}`))
  assert.deepEqual(whole, [])
})
