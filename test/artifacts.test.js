// atelier artifacts adopt (artifacts.js, through the ops client in ops.js) — exercised through the real CLI against a
// fake of the host's op routes (adopt-host.js): the op names the computer and the path inside its drive, nothing goes
// into it, the computer's lines are printed as remote: lines and its code is the exit.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { adoptHost, homeAt, cli } from './adopt-host.js'

const SAID = ['Trip plan · 3 versions · http://portal.test/artifacts/0123456789abcdef01234567', 'done · 1 adopted · 0 already']

test('artifacts adopt asks the host for one op on the path inside the computer\'s drive, sends nothing into it, prints the computer\'s lines as remote: lines and exits with its code', async () => {
  for (const code of [0, 1]) {
    const host = await adoptHost(SAID, code), home = homeAt(host.url)
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
  const host = await adoptHost(SAID, 0), home = homeAt(host.url)
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
