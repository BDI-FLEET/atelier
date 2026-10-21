// Every verb of the hosted CLI reads its arguments with one loop (args.js), its options declared as data: -h prints
// the help rendered from them, the --host line said once from the default host, and an unknown option is refused the
// same way by every verb, before anything is asked of a host. For agent.js, config.js, data.js, files.js, logs.js, ps.js,
// releases.js and restart.js this is the only test: it pins their arguments, not what they answer.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_HOST } from '../session.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CLI = path.resolve(HERE, '..', 'cli.js')

const VERBS = [
  ['login'], ['whoami'], ['logout'], ['computers'], ['create'], ['remote'], ['clone'], ['push'], ['releases'],
  ['logs'], ['ps'], ['restart'], ['run'], ['config'], ['data', 'pull'], ['files', 'sync'], ['agent'], ['attach'], ['agent', 'attach'],
]
const WITH_HOST = new Set(['login', 'whoami', 'logout', 'computers', 'create', 'remote', 'clone', 'files sync', 'agent', 'attach', 'agent attach'])

function cli(home, args) {
  const env = { ...process.env, HOME: home }
  delete env.ATELIER_HOST
  delete env.XDG_CONFIG_HOME
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: home, env, encoding: 'utf8' })
  return { code: r.status, out: r.stdout + r.stderr }
}

test('every verb answers -h with its help (the --host line from the default host) and refuses an unknown option with exit 2', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-args-'))
  try {
    for (const verb of VERBS) {
      const name = verb.join(' ')
      const said = name === 'agent attach' ? name : verb[0]
      const help = cli(home, [...verb, '-h'])
      assert.equal(help.code, 0, `${name}: ${help.out}`)
      assert.match(help.out, new RegExp(`^usage: atelier ${said}`), name)
      if (WITH_HOST.has(name)) assert.match(help.out, new RegExp(`\\n  --host <url> +another host, for this call \\(default: ATELIER_HOST, else ${DEFAULT_HOST}\\)`), name)
      const bad = cli(home, [...verb, '--no-such-option'])
      assert.equal(bad.code, 2, `${name}: ${bad.out}`)
      assert.match(bad.out, new RegExp(`atelier ${said}: unknown option: --no-such-option`), name)
    }
  } finally { fs.rmSync(home, { recursive: true, force: true }) }
})
