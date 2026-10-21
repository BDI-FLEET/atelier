// modules-git.js: atelier add and atelier update for a module that is a git repository, exercised through the real CLI
// against repositories made here. add clones one whose top holds a module.json into the instance under its name; update
// pulls such a clone forward and never touches local edits; anything else goes on to the collection form in add.js.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'cli.js')

const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' })
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}
const head = (dir) => git(dir, 'rev-parse', '--short', 'HEAD')

/* A folder for one test: the instance and the repositories it adds from. */
function place() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-modules-git-'))
  fs.mkdirSync(path.join(dir, 'instance'))
  return { dir, instance: path.join(dir, 'instance') }
}

/* A repository with these files, committed. */
function repo(dir, name, files) {
  const at = path.join(dir, 'src', name)
  fs.mkdirSync(at, { recursive: true })
  git(at, 'init', '-q')
  commit(at, files)
  return at
}
function commit(at, files) {
  for (const [f, body] of Object.entries(files)) fs.writeFileSync(path.join(at, f), body)
  git(at, 'add', '.')
  git(at, 'commit', '-q', '-m', 'change')
  return head(at)
}
const MODULE = { 'module.json': '{ "name": "Notes" }\n', 'frontend.jsx': 'export default function Notes() { return null }\n' }

function cli(instance, args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...process.env, ATELIER_ROOT: instance, GIT_TERMINAL_PROMPT: '0' } })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

test('add clones a repository with a module.json at its top into the instance under the repository\'s name and refuses a second add of that name', () => {
  const { dir, instance } = place()
  try {
    const src = repo(dir, 'notes', MODULE)
    const added = cli(instance, ['add', src])
    assert.equal(added.code, 0, added.out)
    assert.ok(added.out.includes(`added notes · cloned from ${src} at ${head(src)}`), added.out)
    assert.equal(fs.readFileSync(path.join(instance, 'notes', 'module.json'), 'utf8'), MODULE['module.json'])
    assert.equal(git(path.join(instance, 'notes'), 'remote', 'get-url', 'origin'), src, 'the clone keeps its remote, for update')
    const again = cli(instance, ['add', src])
    assert.equal(again.code, 1, again.out)
    assert.match(again.out, /a folder notes is here already · atelier update notes pulls it/)
    assert.deepEqual(fs.readdirSync(instance), ['notes'], 'nothing left beside the clone')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('a repository without a module.json at its top is no module, so add leaves no folder of it and goes on to the collection form', () => {
  const { dir, instance } = place()
  try {
    const src = repo(dir, 'plain', { 'README.md': 'not a module\n' })
    const r = cli(instance, ['add', src])
    assert.equal(r.code, 1, r.out)
    assert.match(r.out, /is not a collection/)
    assert.ok(!fs.existsSync(path.join(instance, 'plain')))
    assert.ok(!fs.readdirSync(instance).some((f) => f.startsWith('.atelier-add-')), 'the trial clone is removed')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('update pulls a clone forward and says from which commit to which, or that it is up to date', () => {
  const { dir, instance } = place()
  try {
    const src = repo(dir, 'notes', MODULE)
    assert.equal(cli(instance, ['add', src]).code, 0)
    const was = head(src), now = commit(src, { 'frontend.jsx': 'export default function Notes() { return "v2" }\n' })
    const pulled = cli(instance, ['update', 'notes'])
    assert.equal(pulled.code, 0, pulled.out)
    assert.ok(pulled.out.includes(`notes · ${was} → ${now}`), pulled.out)
    assert.match(fs.readFileSync(path.join(instance, 'notes', 'frontend.jsx'), 'utf8'), /v2/)
    const same = cli(instance, ['update', 'notes'])
    assert.equal(same.code, 0, same.out)
    assert.ok(same.out.includes(`notes · ${now}, up to date`), same.out)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('update never changes a clone with local edits or local commits: the pull that is no fast-forward is said and exits 1', () => {
  const { dir, instance } = place()
  try {
    const src = repo(dir, 'notes', MODULE)
    assert.equal(cli(instance, ['add', src]).code, 0)
    const clone = path.join(instance, 'notes'), file = path.join(clone, 'frontend.jsx')
    commit(src, { 'frontend.jsx': 'export default function Notes() { return "theirs" }\n' })
    fs.writeFileSync(file, 'export default function Notes() { return "mine, not committed" }\n')
    const edited = cli(instance, ['update', 'notes'])
    assert.equal(edited.code, 1, edited.out)
    assert.match(edited.out, /notes · not pulled: \S/)
    assert.match(fs.readFileSync(file, 'utf8'), /mine, not committed/)
    const mine = commit(clone, { 'frontend.jsx': 'export default function Notes() { return "mine, committed" }\n' })
    const diverged = cli(instance, ['update', 'notes'])
    assert.equal(diverged.code, 1, diverged.out)
    assert.match(diverged.out, /notes · not pulled: \S/)
    assert.equal(head(clone), mine)
    assert.match(fs.readFileSync(file, 'utf8'), /mine, committed/)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('update without a name pulls every module clone that has a remote and leaves a module repository without one alone', () => {
  const { dir, instance } = place()
  try {
    const notes = repo(dir, 'notes', MODULE), tasks = repo(dir, 'tasks', MODULE)
    for (const src of [notes, tasks]) assert.equal(cli(instance, ['add', src]).code, 0)
    const local = path.join(instance, 'local')
    fs.mkdirSync(local)
    git(local, 'init', '-q')
    commit(local, MODULE)
    const moved = [notes, tasks].map((src) => [head(src), commit(src, { 'frontend.jsx': 'export default function M() { return "v2" }\n' })])
    const r = cli(instance, ['update'])
    assert.equal(r.code, 0, r.out)
    assert.ok(r.out.includes(`notes · ${moved[0][0]} → ${moved[0][1]}`), r.out)
    assert.ok(r.out.includes(`tasks · ${moved[1][0]} → ${moved[1][1]}`), r.out)
    assert.ok(!/\blocal ·/.test(r.out), r.out)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
