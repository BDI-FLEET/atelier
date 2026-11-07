// atelier apps adopt (apps.js, through the ops client in ops.js) — exercised through the real CLI against a fake of
// the host's op routes (adopt-host.js): the op names the computer and the path inside its drive, nothing goes into it,
// the computer's lines are printed as remote: lines and its code is the exit.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { adoptHost, homeAt, cli } from './adopt-host.js'

const SAID = ['notes · live @ 3f9c2a1 · http://portal.test/notes', 'done · 1 mounted · 0 already · 0 not mounted']

test('apps adopt asks the host for one op on the path inside the computer\'s drive, sends nothing into it, prints the computer\'s lines as remote: lines and exits with its code', async () => {
  for (const code of [0, 1]) {
    const host = await adoptHost(SAID, code), home = homeAt(host.url)
    try {
      const r = await cli(home, ['apps', 'adopt', 'k1:/archive/apps', '--host', host.url])
      assert.equal(r.code, code, r.err)
      assert.deepEqual(host.asked.map((a) => [a.computer, a.op]), [['k1', { verb: 'apps-adopt', path: 'archive/apps' }]])
      assert.deepEqual(host.ins, [], 'nothing goes into the op')
      assert.deepEqual(r.err.split('\n').filter((l) => l.startsWith('remote: ')), SAID.map((l) => `remote: ${l}`))
    } finally { await host.close(); fs.rmSync(home, { recursive: true, force: true }) }
  }
})

test('apps adopt refuses before asking the host a drive side that is not computer:/path or leaves the drive, a word missing, and any sub-verb but adopt, with exit 2', async () => {
  const host = await adoptHost(SAID, 0), home = homeAt(host.url)
  try {
    for (const [args, said] of [
      [['adopt', 'archive/apps'], 'is not computer:/path'], [['adopt', 'k1:/archive/../..'], 'the path stays inside the drive'],
      [['adopt'], 'adopt takes <computer>:/<path>'], [['publish', 'k1:/x'], 'apps publish? adopt'], [[], 'apps what? adopt']]) {
      const r = await cli(home, ['apps', ...args, '--host', host.url])
      assert.equal(r.code, 2, `${args.join(' ')}: ${r.err}`)
      assert.ok(r.err.includes(said), `${args.join(' ')}: ${r.err}`)
    }
    assert.deepEqual(host.asked, [])
  } finally { await host.close(); fs.rmSync(home, { recursive: true, force: true }) }
})
