// config.js: the CLI's side of an app's settings and secrets, where it refuses before any op.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const CONFIG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'config.js')

test("inside a sandbox, atelier config set is refused at once with the one sentence, no value leaving the process; unset is not refused here", () => {
  const sandbox = { ...process.env, ATELIER_SOCKET: '/nowhere/atelier.sock', ATELIER_SANDBOX: 'sandbox:0f0f0f' }
  const set = spawnSync(process.execPath, [CONFIG, 'set', 'STRIPE_KEY=sk_live_nope', '-r', 'atelier'], { env: sandbox, encoding: 'utf8' })
  assert.equal(set.status, 1, set.stderr)
  assert.match(set.stderr, /a secret's value is set on the portal by the person who looks after the app, never typed to an agent/)
  assert.ok(!set.stderr.includes('sk_live_nope') && !set.stdout.includes('sk_live_nope'), 'the value in the CLI\'s own words')
  const unset = spawnSync(process.execPath, [CONFIG, 'unset', 'STRIPE_KEY', '-r', 'atelier'], { env: sandbox, encoding: 'utf8' })
  assert.ok(!/never typed to an agent/.test(unset.stderr), 'unset goes on to the op')
})
