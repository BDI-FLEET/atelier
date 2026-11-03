// atelier files push (files.js, through the ops client in ops.js) — exercised through the real CLI against a fake host
// whose op answers as a computer's drive does (files-host.js), each answer a round trip later: the files go several at
// once, each file's pieces in order, and the first refusal stops the push.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PIECE, FILES_IN_FLIGHT } from '../limits.js'
import { filesHost, folderOf, STOPPED } from './files-host.js'

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'cli.js')
const ROUND_TRIP_MS = 50
const TWO_PIECES = PIECE + PIECE / 2
const REFUSED = 'that put is not one the drive takes'

/* files push of `folder` to k1:/research at the fake host: its exit code and what it said on stderr. */
async function push(host, home, folder) {
  const env = { ...process.env, HOME: home }
  delete env.ATELIER_HOST; delete env.ATELIER_SOCKET; delete env.ATELIER_SANDBOX; delete env.XDG_CONFIG_HOME
  const p = spawn(process.execPath, [CLI, 'files', 'push', folder, 'k1:/research', '--host', host.url], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  let err = ''
  p.stderr.on('data', (d) => { err += d })
  return { code: await new Promise((r) => p.on('close', r)), err }
}

test('a push sends the pieces of up to FILES_IN_FLIGHT files at once and each file\'s pieces in order, every put after the one before it in that file was answered', async () => {
  const host = await filesHost({ latencyMs: ROUND_TRIP_MS })
  try {
    const { home, folder, shas } = folderOf(host.url, Array.from({ length: 3 * FILES_IN_FLIGHT }, () => TWO_PIECES))
    const { code, err } = await push(host, home, folder)
    assert.equal(code, 0, err)
    assert.equal(host.peakOpen(), FILES_IN_FLIGHT)
    for (const sha of shas) {
      const mine = host.puts.filter((p) => p.sha === sha)
      assert.deepEqual(mine.map((p) => p.at), [0, PIECE], sha)
      assert.ok(mine[0].answered < mine[1].came, `${sha}: its second piece came before its first was answered`)
    }
    assert.deepEqual(host.puts.filter((p) => p.early), [])
    assert.deepEqual(host.places.map((f) => f.sha256).sort(), [...shas].sort())
    assert.equal(host.ends.length, 1)
  } finally { await host.close() }
})

test('a put refused while other files are in flight stops the push: no file starts after it, nothing is placed, and its words are the push\'s error', async () => {
  let refusedSha = null
  const host = await filesHost({ latencyMs: ROUND_TRIP_MS, refused: REFUSED, refuse: (p) => p.sha === refusedSha && p.at === 0 })
  try {
    const { home, folder, shas } = folderOf(host.url, Array.from({ length: 3 * FILES_IN_FLIGHT }, () => TWO_PIECES))
    refusedSha = shas[2]
    const { code, err } = await push(host, home, folder)
    assert.equal(code, 1, err)
    const refusal = host.refusal()
    assert.ok(refusal, 'the drive refused no put')
    assert.ok(refusal.othersOpen > 0, 'no other file was in flight when the put was refused')
    const firsts = new Map()
    for (const p of host.puts) if (!firsts.has(p.sha)) firsts.set(p.sha, p)
    assert.deepEqual([...firsts.values()].filter((p) => p.came > refusal.answered).map((p) => p.sha), [])
    assert.deepEqual(host.places, [])
    assert.deepEqual(host.ends, [])
    assert.deepEqual(err.split('\n').filter((l) => l.startsWith('remote: ')).sort(), [`remote: ${REFUSED}`, `remote: ${STOPPED}`].sort(), err)
  } finally { await host.close() }
})
