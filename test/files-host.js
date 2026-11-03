// A fake host whose one op is a files push into a computer's drive, answered as the computer answers one
// (core supervisor/rules/ops-files.ts): `have` → what the drive lacks, a put whose `at` is not its part's size → that
// size, `place` → each part whole by its sha256, `end` → done. Every answer waits `latencyMs`, as a round trip through
// the host to the computer does. It keeps what a test reads of the puts: when each came and was answered, and which
// files were open (their first put came, their last not answered yet) at each moment.
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

export const SECRET = 'sess_test_6c1e9a4f2b7d3e8a5c0f1b6d9e2a7c4f'
const OP = 'op-7a8b9c0d'
/* What the computer says of a push that stopped before its end. */
export const STOPPED = 'the copy stopped before it ended; push again: it goes on where it stopped'

/* `refuse(put)` names the put the drive refuses, answered with `refused` in its place; once one is refused the drive
 * ends the op as a computer does when no more comes: its line, then code 1. */
export async function filesHost({ latencyMs = 0, refuse = () => false, refused = 'that put is not one the drive takes', quietMs = 4 * latencyMs + 50 } = {}) {
  const sizes = new Map(), parts = new Map(), open = new Set()
  const puts = [], places = [], ends = []
  let stream = null, clock = 0, peakOpen = 0, refusal = null, quiet = null
  const say = (f) => stream?.write(JSON.stringify(f) + '\n')
  const later = (fn) => setTimeout(fn, latencyMs)
  const stopsQuietly = () => {
    if (!refusal) return
    clearTimeout(quiet)
    quiet = setTimeout(() => { say({ line: STOPPED }); say({ done: true, code: 1 }) }, quietMs)
  }
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
    if (req.method !== 'POST' || req.url !== `/api/ops/${OP}/in`) return send(404, { error: 'no such route' })
    stopsQuietly()
    if (Array.isArray(body.have)) {
      for (const f of body.have) sizes.set(f.sha256, f.size)
      return later(() => send(200, { need: [...new Set(body.have.map((f) => f.sha256))].map((sha256) => ({ sha256, from: (parts.get(sha256) ?? Buffer.alloc(0)).length })) }))
    }
    if (typeof body.put === 'string') {
      const sha = body.put, have = parts.get(sha) ?? Buffer.alloc(0)
      const put = { sha, at: body.at, came: ++clock, answered: null, early: body.at !== have.length, othersOpen: 0 }
      puts.push(put)
      if (!open.has(sha)) { open.add(sha); peakOpen = Math.max(peakOpen, open.size) }
      return later(() => {
        put.answered = ++clock
        put.othersOpen = open.size - 1
        if (refuse(put)) { refusal ??= put; send(200, { refused }); stopsQuietly(); return }
        if (put.early) return send(200, { at: have.length })
        const now = Buffer.concat([have, Buffer.from(body.data, 'base64')])
        parts.set(sha, now)
        if (now.length >= sizes.get(sha)) open.delete(sha)
        send(200, { at: now.length })
      })
    }
    if (Array.isArray(body.place)) {
      places.push(...body.place)
      const whole = (f) => parts.has(f.sha256) && crypto.createHash('sha256').update(parts.get(f.sha256)).digest('hex') === f.sha256
      return later(() => send(200, { placed: body.place.filter(whole).length, missing: body.place.filter((f) => !whole(f)).map((f) => f.path) }))
    }
    if (body.end) {
      ends.push(body)
      return later(() => { send(200, { ok: true }); say({ line: `done · ${sizes.size} files` }); say({ done: true, code: 0 }) })
    }
    send(200, { refused: 'files push takes have, put, place and end' })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${server.address().port}`
  return {
    url, puts, places, ends, parts,
    peakOpen: () => peakOpen,
    refusal: () => refusal,
    close: () => new Promise((r) => { clearTimeout(quiet); server.closeAllConnections(); server.close(r) }),
  }
}

/* A home signed in at `url`, and a folder of files of the given sizes, each of its own random bytes. */
export function folderOf(url, sizes, base = os.tmpdir()) {
  const home = fs.mkdtempSync(path.join(base, 'atelier-files-'))
  const config = path.join(home, '.config', 'atelier')
  fs.mkdirSync(config, { recursive: true, mode: 0o700 })
  fs.writeFileSync(path.join(config, 'credentials'), JSON.stringify({
    [url]: { session: SECRET, expires: '2099-10-31T12:00:00.000Z', person: { id: 'person:7f3a2c', name: 'Alex' } },
  }), { mode: 0o600 })
  const folder = path.join(home, 'research')
  fs.mkdirSync(folder)
  const shas = sizes.map((size, i) => {
    const bytes = crypto.randomBytes(size)
    fs.writeFileSync(path.join(folder, `${String(i).padStart(3, '0')}.bin`), bytes)
    return crypto.createHash('sha256').update(bytes).digest('hex')
  })
  return { home, folder, shas }
}
