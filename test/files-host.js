// A fake host whose one op is a files push or pull on a computer's drive, answered as the computer answers one
// (core supervisor/rules/ops-files.ts). Every answer waits `latencyMs`, as a round trip through the host to the computer
// does. It keeps what a test reads of the pieces (puts or gets): when each came and was answered, and how many files
// were open at once (their first piece came, their last not answered yet). `refuse(piece)` names the piece the drive
// refuses, answered with `refused` in its place; once one is refused the drive ends the op as a computer does when no
// more comes: its line, then code 1.
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { PIECE } from '../limits.js'

export const SECRET = 'sess_test_6c1e9a4f2b7d3e8a5c0f1b6d9e2a7c4f'
const OP = 'op-7a8b9c0d'
/* What the computer says of a copy that stopped before its end. */
export const STOPPED = 'the copy stopped before it ended; push again: it goes on where it stopped'

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex')

/* The op's routes; `answer(body)` answers what goes into it ({ body, through?, done? }), `piece(body)` names the file
 * and the place of a put or a get ({ file, at, size } or null); a file is open until a piece is answered through its size. */
async function opHost({ latencyMs = 0, refuse = () => false, refused = 'the drive does not take that piece', quietMs = 4 * latencyMs + 50 }, { piece, answer }) {
  const open = new Set(), pieces = []
  let stream = null, clock = 0, peakOpen = 0, refusal = null, quiet = null
  const say = (f) => stream?.write(JSON.stringify(f) + '\n')
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
    const at = piece(body)
    const p = at && { ...at, came: ++clock, answered: null, othersOpen: 0 }
    if (p) {
      pieces.push(p)
      if (!open.has(p.file)) { open.add(p.file); peakOpen = Math.max(peakOpen, open.size) }
    }
    setTimeout(() => {
      if (p) {
        p.answered = ++clock
        p.othersOpen = open.size - 1
        if (refuse(p)) { refusal ??= p; send(200, { refused }); stopsQuietly(); return }
      }
      const a = answer(body)
      if (p && a.through >= p.size) open.delete(p.file)
      send(200, a.body)
      if (a.done) { say({ line: 'done' }); say({ done: true, code: 0 }) }
    }, latencyMs)
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    pieces,
    peakOpen: () => peakOpen,
    refusal: () => refusal,
    close: () => new Promise((r) => { clearTimeout(quiet); server.closeAllConnections(); server.close(r) }),
  }
}

/* A drive a push goes into: `have` → what it lacks, a put whose `at` is not its part's size → that size (`early`),
 * `place` → each part whole by its sha256, `end` → done. */
export async function pushHost(opts = {}) {
  const sizes = new Map(), parts = new Map(), places = [], ends = []
  const partOf = (sha) => parts.get(sha) ?? Buffer.alloc(0)
  const host = await opHost(opts, {
    piece: (b) => typeof b.put === 'string' ? { file: b.put, at: b.at, size: sizes.get(b.put), early: b.at !== partOf(b.put).length } : null,
    answer: (b) => {
      if (Array.isArray(b.have)) {
        for (const f of b.have) sizes.set(f.sha256, f.size)
        return { body: { need: [...new Set(b.have.map((f) => f.sha256))].map((sha) => ({ sha256: sha, from: partOf(sha).length })) } }
      }
      if (typeof b.put === 'string') {
        const have = partOf(b.put)
        if (b.at !== have.length) return { body: { at: have.length }, through: have.length }
        const now = Buffer.concat([have, Buffer.from(b.data, 'base64')])
        parts.set(b.put, now)
        return { body: { at: now.length }, through: now.length }
      }
      if (Array.isArray(b.place)) {
        places.push(...b.place)
        const whole = (f) => parts.has(f.sha256) && sha256(parts.get(f.sha256)) === f.sha256
        return { body: { placed: b.place.filter(whole).length, missing: b.place.filter((f) => !whole(f)).map((f) => f.path) } }
      }
      if (b.end) { ends.push(b); return { body: { ok: true }, done: true } }
      return { body: { refused: 'files push takes have, put, place and end' } }
    },
  })
  return { ...host, puts: host.pieces, places, ends }
}

/* A drive a pull comes from, holding `files` ({ path, bytes }): `list` → all of them, a get → the piece of at most PIECE
 * from its `at`, `end` → done. */
export async function pullHost({ files, ...opts }) {
  const ends = []
  const byPath = new Map(files.map((f) => [f.path, f.bytes]))
  const host = await opHost(opts, {
    piece: (b) => typeof b.get === 'string' ? { file: b.get, at: b.at, size: byPath.get(b.get).length } : null,
    answer: (b) => {
      if (b.list) return { body: { files: files.map((f) => ({ path: f.path, size: f.bytes.length, sha256: sha256(f.bytes), mtime: Date.now() })), more: false } }
      if (typeof b.get === 'string') {
        const data = byPath.get(b.get).subarray(b.at, b.at + PIECE)
        return { body: { data: data.toString('base64'), at: b.at, size: byPath.get(b.get).length }, through: b.at + data.length }
      }
      if (b.end) { ends.push(b); return { body: { ok: true }, done: true } }
      return { body: { refused: 'files pull takes list, get and end' } }
    },
  })
  return { ...host, gets: host.pieces, ends }
}

/* A home signed in at `url`. */
export function homeAt(url, base = os.tmpdir()) {
  const home = fs.mkdtempSync(path.join(base, 'atelier-files-'))
  const config = path.join(home, '.config', 'atelier')
  fs.mkdirSync(config, { recursive: true, mode: 0o700 })
  fs.writeFileSync(path.join(config, 'credentials'), JSON.stringify({
    [url]: { session: SECRET, expires: '2099-10-31T12:00:00.000Z', person: { id: 'person:7f3a2c', name: 'Alex' } },
  }), { mode: 0o600 })
  return home
}

/* Files of the given sizes, each of its own random bytes, named in the order given: { path, bytes, sha256 }. */
export const filesOf = (sizes) => sizes.map((size, i) => {
  const bytes = crypto.randomBytes(size)
  return { path: `${String(i).padStart(3, '0')}.bin`, bytes, sha256: sha256(bytes) }
})

/* A folder in `home` holding `files`. */
export function folderOf(home, files) {
  const folder = path.join(home, 'research')
  fs.mkdirSync(folder)
  for (const f of files) fs.writeFileSync(path.join(folder, f.path), f.bytes)
  return folder
}
