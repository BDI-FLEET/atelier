// atelier memory adopt (memory.js, through the ops client in ops.js) — exercised through the real CLI against a fake of
// the host's op routes (adopt-host.js): the op names the computer and the path inside its drive, nothing goes into it,
// the computer's lines are printed as remote: lines and its code is the exit.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { adoptHost, homeAt, cli } from './adopt-host.js'

const SAID = ['memory · 3 placed · 0 joined · 0 beside · 0 already · 0 not adopted', 'done · 3 placed · 0 already']

test('memory adopt asks the host for one op on the path inside the computer\'s drive, sends nothing into it, prints the computer\'s lines as remote: lines and exits with its code', async () => {
  for (const code of [0, 1]) {
    const host = await adoptHost(SAID, code), home = homeAt(host.url)
    try {
      const r = await cli(home, ['memory', 'adopt', 'k1:/archive/agent', '--host', host.url])
      assert.equal(r.code, code, r.err)
      assert.deepEqual(host.asked.map((a) => [a.computer, a.op]), [['k1', { verb: 'memory-adopt', path: 'archive/agent' }]])
      assert.deepEqual(host.ins, [], 'nothing goes into the op')
      assert.deepEqual(r.err.split('\n').filter((l) => l.startsWith('remote: ')), SAID.map((l) => `remote: ${l}`))
    } finally { await host.close(); fs.rmSync(home, { recursive: true, force: true }) }
  }
})

test('memory adopt refuses before asking the host a drive side that is not computer:/path or leaves the drive, a word missing, and any sub-verb but adopt, with exit 2', async () => {
  const host = await adoptHost(SAID, 0), home = homeAt(host.url)
  try {
    for (const [args, said] of [
      [['adopt', 'archive/agent'], 'is not computer:/path'], [['adopt', 'k1:/archive/../..'], 'the path stays inside the drive'],
      [['adopt'], 'adopt takes <computer>:/<path>'], [['forget', 'k1:/x'], 'memory forget? adopt'], [[], 'memory what? adopt']]) {
      const r = await cli(home, ['memory', ...args, '--host', host.url])
      assert.equal(r.code, 2, `${args.join(' ')}: ${r.err}`)
      assert.ok(r.err.includes(said), `${args.join(' ')}: ${r.err}`)
    }
    assert.deepEqual(host.asked, [])
  } finally { await host.close(); fs.rmSync(home, { recursive: true, force: true }) }
})
