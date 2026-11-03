// atelier files push and pull (files.js, through the ops client in ops.js) — exercised through the real CLI against a
// fake host whose op answers as a computer's drive does (files-host.js), each answer a round trip later: the files go
// several at once, each file's pieces in order, and the first refusal stops the copy.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PIECE, FILES_IN_FLIGHT } from '../limits.js'
import { pushHost, pullHost, homeAt, filesOf, folderOf, STOPPED } from './files-host.js'

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'cli.js')
const ROUND_TRIP_MS = 50
const TWO_PIECES = PIECE + PIECE / 2
const REFUSED = 'the drive does not take that piece'
const someFiles = () => filesOf(Array.from({ length: 3 * FILES_IN_FLIGHT }, () => TWO_PIECES))

/* atelier files <args> at the fake host from `home`: its exit code and what it said on stderr. */
async function files(host, home, args) {
  const env = { ...process.env, HOME: home }
  delete env.ATELIER_HOST; delete env.ATELIER_SOCKET; delete env.ATELIER_SANDBOX; delete env.XDG_CONFIG_HOME
  const p = spawn(process.execPath, [CLI, 'files', ...args, '--host', host.url], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  let err = ''
  p.stderr.on('data', (d) => { err += d })
  return { code: await new Promise((r) => p.on('close', r)), err }
}

/* As many files open at once as FILES_IN_FLIGHT, and each file's pieces from 0 in order, each after the one before it was answered. */
function inFlightInOrder(host, names) {
  assert.equal(host.peakOpen(), FILES_IN_FLIGHT)
  for (const name of names) {
    const mine = host.pieces.filter((p) => p.file === name)
    assert.deepEqual(mine.map((p) => p.at), [0, PIECE], name)
    assert.ok(mine[0].answered < mine[1].came, `${name}: its second piece came before its first was answered`)
  }
}

/* The refusal came while other files were open, no file started after it, and its words are the copy's error. */
function stoppedBy(host, { code, err }) {
  assert.equal(code, 1, err)
  const refusal = host.refusal()
  assert.ok(refusal, 'the drive refused no piece')
  assert.ok(refusal.othersOpen > 0, 'no other file was in flight when the piece was refused')
  const firsts = new Map()
  for (const p of host.pieces) if (!firsts.has(p.file)) firsts.set(p.file, p)
  assert.deepEqual([...firsts.values()].filter((p) => p.came > refusal.answered).map((p) => p.file), [])
  assert.deepEqual(host.ends, [])
  assert.deepEqual(err.split('\n').filter((l) => l.startsWith('remote: ')).sort(), [`remote: ${REFUSED}`, `remote: ${STOPPED}`].sort(), err)
}

test('a push sends the pieces of up to FILES_IN_FLIGHT files at once and each file\'s pieces in order, every put after the one before it in that file was answered', async () => {
  const host = await pushHost({ latencyMs: ROUND_TRIP_MS })
  try {
    const home = homeAt(host.url), all = someFiles()
    const run = await files(host, home, ['push', folderOf(home, all), 'k1:/research'])
    assert.equal(run.code, 0, run.err)
    inFlightInOrder(host, all.map((f) => f.sha256))
    assert.deepEqual(host.puts.filter((p) => p.early), [])
    assert.deepEqual(host.places.map((f) => f.sha256).sort(), all.map((f) => f.sha256).sort())
    assert.equal(host.ends.length, 1)
  } finally { await host.close() }
})

test('a put refused while other files are in flight stops the push: no file starts after it, nothing is placed, and its words are the push\'s error', async () => {
  const all = someFiles()
  const host = await pushHost({ latencyMs: ROUND_TRIP_MS, refused: REFUSED, refuse: (p) => p.file === all[2].sha256 && p.at === 0 })
  try {
    const home = homeAt(host.url)
    stoppedBy(host, await files(host, home, ['push', folderOf(home, all), 'k1:/research']))
    assert.deepEqual(host.places, [])
  } finally { await host.close() }
})

test('a pull fetches the pieces of up to FILES_IN_FLIGHT files at once and each file\'s pieces in order, every get after the one before it in that file was answered', async () => {
  const all = someFiles()
  const host = await pullHost({ files: all, latencyMs: ROUND_TRIP_MS })
  try {
    const home = homeAt(host.url), down = path.join(home, 'down')
    const run = await files(host, home, ['pull', 'k1:/research', down])
    assert.equal(run.code, 0, run.err)
    inFlightInOrder(host, all.map((f) => f.path))
    assert.deepEqual(all.filter((f) => !f.bytes.equals(fs.readFileSync(path.join(down, f.path)))).map((f) => f.path), [])
    assert.equal(host.ends.length, 1)
  } finally { await host.close() }
})

test('a get refused while other files are in flight stops the pull: no file starts after it, the refused file is not placed, and its words are the pull\'s error', async () => {
  const all = someFiles()
  const host = await pullHost({ files: all, latencyMs: ROUND_TRIP_MS, refused: REFUSED, refuse: (p) => p.file === all[2].path && p.at === 0 })
  try {
    const home = homeAt(host.url), down = path.join(home, 'down')
    stoppedBy(host, await files(host, home, ['pull', 'k1:/research', down]))
    assert.equal(fs.existsSync(path.join(down, all[2].path)), false)
  } finally { await host.close() }
})
