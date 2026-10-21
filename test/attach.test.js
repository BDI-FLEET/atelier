// atelier attach (attach.js) and atelier agent attach (agent-attach.js), one client (attach-client.js), exercised
// through the real CLI against an in-process fake of the host API's four attach routes: the
// exit codes, the footer and the detach sentence, agent attach
// writing by default, --watch without input, the target's defaults (the remote computer's main, a bare name, /name on
// the remote, several computers refused), a revoked session, the shell with another person's line marked; in a
// real terminal (a tmux pane): the size said and followed, the scrollback's
// gestures, and the terminal given back as it was; the wheel, notch by notch,
// on both verbs (a scrolled view kept while the pane writes on, the bottom
// following it again), and a screen with no scrollback said in the footer; the keys that stop a program kept from the
// agent's session, the shell's own exit a way out, a screen closed before its first frame a refusal, each verb's file
// run on its own, and markedLines on its own.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { markedLines, SHELL_EXITED } from '../attach-client.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CLI = path.resolve(HERE, '..', 'cli.js')
const SECRET = 'sess_test_5b1e0c9a7d3f4e2a8c6b0d1f3e5a7c9b'
const REFUSED = 'no grant: chat:k1/main#member@person:b41e90'

// The computers the fake host lists (GET /api/computers): the label is the word a remote and `atelier computers` use, the
// id the host's own name for it, which an attach target carries.
const ONE = [{ id: 'k1', label: 'alex', kind: 'own', line: 'your own', modules: [] }]
const TWO = [...ONE, { id: 't9', label: 'team', kind: 'room', line: 'shared with your team', modules: [] }]

// The fake host: one attach at a time; a frame at once, a new one per keys call; detach ends the stream.
// `history`: the rows of scrollback above the screen; 0 is a screen that keeps none (its program on the alternate screen),
// where a scroll up is answered as the host answers it. `frameAtOnce: false` opens the screen without a frame.
async function fakeHost({ grant = true, handover = true, computers = ONE, history = 100, frameAtOnce = true } = {}) {
  const calls = []
  const keys = []
  const views = []
  let up = 0
  let screen = null
  let lines = ['fake agent · pid 42 · as agent:e5a7b2', '']
  // the rows a scrolled view shows: as the bridge does, they stay while the pane writes more (and `up` grows with it)
  let held = null
  const here = [{ attach: 'at-0123abcd', name: 'Alex', mode: 'write' }]
  const marks = []
  const frame = () => ({ t: new Date().toISOString(), rows: lines.length, cols: 200, lines, cursor: { x: 0, y: lines.length - 1 }, here, marks })
  const scrolledFrame = () => ({ ...frame(), lines: held, scrolled: { up, history } })
  const current = () => (up ? scrolledFrame() : frame())
  const server = http.createServer(async (req, res) => {
    let raw = ''
    for await (const c of req) raw += c
    const body = raw ? JSON.parse(raw) : {}
    calls.push({ method: req.method, url: req.url, body, auth: req.headers.authorization || null })
    const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }
    if (req.headers.authorization !== `Session ${SECRET}`) return send(401, { refused: 'the session is not valid; sign in again' })
    if (req.method === 'GET' && req.url === '/api/computers') return send(200, { computers })
    if (req.method === 'POST' && req.url === '/api/attach') {
      if (!grant) return send(403, { refused: REFUSED })
      return send(201, { attach: 'at-0123abcd', computer: 'k1', workspace: 'main', mode: body.mode, onto: body.onto })
    }
    if (req.method === 'GET' && req.url === '/api/attach/at-0123abcd/screen') {
      res.writeHead(200, { 'content-type': 'application/x-ndjson' })
      screen = res
      if (frameAtOnce) res.write(JSON.stringify(frame()) + '\n')
      return
    }
    if (req.method === 'POST' && req.url === '/api/attach/at-0123abcd/keys') {
      keys.push(body.keys)
      const typed = keys.join('').split('\r')
      lines = ['fake agent · pid 42 · as agent:e5a7b2', ...typed.slice(0, -1).map((l) => `heard: ${l}`), typed.at(-1)]
      // a key typed brings the view back to the bottom, as the bridge does
      up = 0; held = null
      screen?.write(JSON.stringify(frame()) + '\n')
      return send(202, { sent: true })
    }
    if (req.method === 'POST' && req.url === '/api/attach/at-0123abcd/view') {
      views.push(body)
      // a scroll moves this view up into the scrollback; at the bottom again the frame says nothing of it
      if (body.scroll > 0 && history === 0) screen?.write(JSON.stringify({ refused: 'nothing to scroll back to: the program on this screen keeps its history itself' }) + '\n')
      else if (body.scroll) {
        up = Math.min(history, Math.max(0, up + body.scroll))
        held = up ? Array.from({ length: lines.length }, (_, i) => `scrollback row ${history - up + i}`) : null
        screen?.write(JSON.stringify(current()) + '\n')
      }
      return send(202, { sent: true })
    }
    if (req.method === 'POST' && req.url === '/api/attach/at-0123abcd/detach') {
      screen?.end(JSON.stringify({ closed: 'the client went', handover }) + '\n')
      return send(200, { ok: true, handover })
    }
    send(404, { refused: 'No such route.' })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    calls, keys, views,
    /* someone else attaches (their name in the next frame), or the host closes the screen */
    join: (name, mode = 'watch') => { here.push({ attach: 'at-ffff0000', name, mode }); screen?.write(JSON.stringify(frame()) + '\n') },
    /* the screen becomes these lines; `by` marks rows someone started typing ({ row: attach id }) */
    show: (next, by = {}) => {
      lines = next
      marks.splice(0, marks.length, ...Object.entries(by).map(([row, attach]) => ({ row: Number(row), attach, person: attach === 'at-ffff0000' ? 'person:b41e90' : 'person:7f3a2c', name: here.find((h) => h.attach === attach)?.name })))
      screen?.write(JSON.stringify(current()) + '\n')
    },
    /* the pane writes `n` more lines, the last one `last`: a scrolled view keeps its rows and is that much further up */
    write: (n, last) => {
      lines = [...lines.slice(n), ...Array.from({ length: n - 1 }, (_, i) => `line ${i}`), last].slice(-lines.length)
      if (up) { history += n; up += n }
      screen?.write(JSON.stringify(current()) + '\n')
    },
    closeScreen: (why) => screen?.end(JSON.stringify({ closed: why }) + '\n'),
    close: () => new Promise((r) => { server.closeAllConnections(); server.close(r) }),
  }
}

/* A CLI run whose stdin we keep open and write into; `until` waits for its output. */
function attach(home, args, verb = ['agent', 'attach'], env = {}, cwd = home) {
  return running([CLI, ...verb, ...args], home, env, cwd)
}

/* A node script run with this home, as attach runs the CLI. */
function running(argv, home, env = {}, cwd = home) {
  const childEnv = { ...process.env, HOME: home, ...env }
  delete childEnv.XDG_CONFIG_HOME
  if (!('ATELIER_HOST' in env)) delete childEnv.ATELIER_HOST
  // run in a folder of its own (by default the throwaway home): never inside a module folder by accident
  const p = spawn(process.execPath, argv, { cwd, env: childEnv, stdio: ['pipe', 'pipe', 'pipe'] })
  let stdout = '', stderr = ''
  p.stdout.on('data', (d) => { stdout += d })
  p.stderr.on('data', (d) => { stderr += d })
  const closed = new Promise((resolve) => p.on('close', (code) => resolve(code)))
  return {
    type: (s) => p.stdin.write(s),
    get out() { return stdout + stderr },
    async until(what, ok, ms = 3000) {
      for (const end = Date.now() + ms; !ok(); await new Promise((r) => setTimeout(r, 20)))
        if (Date.now() > end) { p.kill(); throw new Error(`waited for ${what}; output:\n${stdout + stderr}`) }
    },
    closed: async () => ({ code: await closed, out: stdout + stderr }),
  }
}

const tmpHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-attach-'))
function signedInHome(host) {
  const home = tmpHome()
  const dir = path.join(home, '.config', 'atelier')
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  fs.writeFileSync(path.join(dir, 'credentials'), JSON.stringify({
    [host]: { session: SECRET, expires: '2026-10-31T12:00:00.000Z', person: { id: 'person:7f3a2c', name: 'Alex' }, network: 'fake', number: '+15555550100' },
  }), { mode: 0o600 })
  return home
}

test('the exit codes: 2 written wrongly, 3 not signed in (and no call), 4 no grant with the host\'s sentence', async () => {
  for (const args of [['k1/main/x'], ['--now'], ['a', 'b']]) {
    const r = await attach(tmpHome(), args).closed()
    assert.equal(r.code, 2, `${args}: ${r.out}`)
    assert.match(r.out, /usage: atelier agent attach/)
  }
  const host = await fakeHost({ grant: false })
  try {
    const out = await attach(tmpHome(), ['--host', host.url]).closed()
    assert.equal(out.code, 3, out.out)
    assert.match(out.out, new RegExp(`not signed in at ${host.url} · atelier login --host ${host.url}`))
    assert.equal(host.calls.length, 0)
    const no = await attach(signedInHome(host.url), ['k1/main', '--host', host.url]).closed()
    assert.equal(no.code, 4, no.out)
    assert.ok(no.out.includes(REFUSED), no.out)
    assert.ok(!no.out.includes(SECRET))
  } finally { await host.close() }
})

test('agent attach writes by default (talking to an agent and attaching to it are one right): the footer says who else is here and that you type to the agent, your keys go to the host in order, Ctrl-] detaches with the sentence (the workspace keeps running, the handover written) and exits 0', async () => {
  const host = await fakeHost()
  try {
    // the default host is the one ATELIER_HOST names; no --host
    const a = attach(signedInHome(host.url), [], undefined, { ATELIER_HOST: host.url })
    await a.until('the first frame', () => a.out.includes('fake agent · pid 42'))
    assert.ok(a.out.includes('attached · k1/main · also here: nobody · typing to the agent'), a.out)
    assert.deepEqual(['onto', 'mode', 'target'].map((k) => host.calls.find((c) => c.url === '/api/attach').body[k]), ['agent', 'write', 'k1/main'],
      'no name, no remote, one computer: that one\'s main')
    host.join('Sam')
    await a.until('Sam in the footer', () => a.out.includes('attached · k1/main · also here: Sam · typing to the agent'))
    a.type('why did you say that\r')
    await a.until('the agent heard it', () => a.out.includes('heard: why did you say that'))
    a.type('\x1d')
    const r = await a.closed()
    assert.equal(r.code, 0, r.out)
    assert.match(r.out, /detached · the workspace keeps running · handover written/)
    assert.equal(host.keys.join(''), 'why did you say that\r', 'your keys reach the host, in order')
    assert.ok(!r.out.includes(SECRET), 'the session must never reach the terminal')
  } finally { await host.close() }
})


test('agent attach --write says the default out loud and --write with --watch is written wrongly', async () => {
  const host = await fakeHost()
  try {
    const a = attach(signedInHome(host.url), ['k1/main', '--write', '--host', host.url])
    await a.until('the first frame', () => a.out.includes('fake agent · pid 42'))
    assert.deepEqual(['onto', 'mode'].map((k) => host.calls.find((c) => c.url === '/api/attach').body[k]), ['agent', 'write'])
    a.type('\x1d')
    const r = await a.closed()
    assert.equal(r.code, 0, r.out)
    const both = await attach(signedInHome(host.url), ['--write', '--watch', '--host', host.url]).closed()
    assert.equal(both.code, 2, both.out)
    assert.match(both.out, /--watch or --write, not both/)
    assert.match(both.out, /usage: atelier agent attach \[computer\]\[\/workspace\] \[--watch\]/)
  } finally { await host.close() }
})


test('agent attach --watch shows the screen without input: keys are never sent', async () => {
  const host = await fakeHost({ handover: false })
  try {
    const a = attach(signedInHome(host.url), ['/main', '--watch', '--host', host.url])
    await a.until('the first frame', () => a.out.includes('fake agent · pid 42'))
    assert.ok(a.out.includes('attached · k1/main · also here: nobody · watch'), a.out)
    assert.deepEqual(['onto', 'mode'].map((k) => host.calls.find((c) => c.url === '/api/attach').body[k]), ['agent', 'watch'])
    a.type('rm -rf /\r')
    await new Promise((r) => setTimeout(r, 150))
    a.type('\x1d')
    const r = await a.closed()
    assert.equal(r.code, 0, r.out)
    assert.match(r.out, /detached · the workspace keeps running · others still here/)
    assert.equal(host.keys.length, 0)
    assert.ok(!host.calls.some((c) => c.url.endsWith('/keys')))
  } finally { await host.close() }
})


test('the names default to the remote computer\'s main alone, a computer for a bare name and a workspace on the remote for /name, and with several computers and no remote the refusal names them and atelier remote', async () => {
  const host = await fakeHost({ computers: TWO })
  /* What the CLI asked to attach to, for these words, run in this folder; or how it was refused. */
  const asks = async (args, cwd, verb = undefined) => {
    const before = host.calls.length
    const a = attach(signedInHome(host.url), [...args, '--host', host.url], verb, {}, cwd)
    let ended = null
    a.closed().then((r) => { ended = r })
    await a.until('the first frame, or the end', () => ended !== null || a.out.includes('fake agent · pid 42'))
    if (ended) return { refused: ended }
    a.type('\x1d')
    await a.closed()
    return host.calls.slice(before).find((c) => c.url === '/api/attach').body.target
  }
  // a module folder whose remote `atelier` (what atelier remote sets) points at the computer labelled team on this host
  const moduleFolder = (host) => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-attach-module-'))
    fs.writeFileSync(path.join(d, 'module.json'), JSON.stringify({ name: 'Notes' }) + '\n')
    execFileSync('git', ['init', '-q'], { cwd: d })
    execFileSync('git', ['remote', 'add', 'atelier', `${host}/git/team/notes.git`], { cwd: d })
    return d
  }
  try {
    const here = moduleFolder(host.url)
    assert.equal(await asks([], here), 't9/main', 'alone: the remote computer\'s main, by the host\'s own name')
    assert.equal(await asks([], here, ['attach']), 't9/main', 'atelier attach the same: the remote computer\'s main')
    assert.equal(await asks(['/pair'], here), 't9/pair', 'a leading slash: a workspace on the remote')
    assert.equal(await asks(['alex'], here), 'k1/main', 'a bare name is a computer, its main: the remote does not count')
    assert.equal(await asks(['k1'], here), 'k1/main', 'the host\'s own name works as well')
    assert.equal(await asks(['team/pair']), 't9/pair', 'the full path always works')
    assert.equal(await asks(['elsewhere/main']), 'elsewhere/main', 'a name it does not know goes as typed: the host answers')
    // several computers, no remote (outside a module folder, or a remote at another host): the CLI does not pick
    for (const cwd of [undefined, moduleFolder('http://127.0.0.1:1')]) {
      const { refused } = await asks([], cwd)
      assert.equal(refused.code, 2, refused.out)
      assert.match(refused.out, /which computer\? you are in 2: alex, team · name one, alex, or point a module folder at one: atelier remote <computer>/)
    }
    const { refused } = await asks(['/pair'])
    assert.match(refused.out, /name one, alex\/pair, or point a module folder at one/)
    assert.equal(host.calls.filter((c) => c.url === '/api/attach').length, 7, 'a refused default never reaches the attach')
  } finally { await host.close() }
})


test('a revoked session closes the attach: exit 1 with the host\'s sentence', async () => {
  const host = await fakeHost()
  try {
    const a = attach(signedInHome(host.url), ['--host', host.url])
    await a.until('the first frame', () => a.out.includes('fake agent · pid 42'))
    host.closeScreen('the session was revoked')
    const r = await a.closed()
    assert.equal(r.code, 1, r.out)
    assert.match(r.out, /k1\/main closed the attach: the session was revoked/)
  } finally { await host.close() }
})


test('attach puts the terminal onto the workspace\'s shell, shows the name in front of a line someone else typed and not in front of yours, and Ctrl-] detaches with the sentence and exit 0', async () => {
  const host = await fakeHost()
  try {
    const a = attach(signedInHome(host.url), ['k1/main', '--host', host.url], ['attach'])
    await a.until('the first frame', () => a.out.includes('fake agent · pid 42'))
    assert.equal(host.calls.find((c) => c.url === '/api/attach').body.onto, 'shell')
    assert.ok(a.out.includes('attached · k1/main · also here: nobody'), a.out)
    host.join('Sam', 'write')
    // row 0 typed in this terminal, row 2 by Sam, row 4 by Alex in another terminal of theirs
    host.show(['~ $ git status', 'On branch main', '~ $ npm test -- invoice', '2 failing', '~ $ ls', 'files', '~ $ '], { 0: 'at-0123abcd', 2: 'at-ffff0000', 4: 'at-aaaa1111' })
    await a.until('Sam\'s line with the name in front', () => a.out.includes('[Sam] ~ $ npm test -- invoice'))
    assert.ok(!a.out.includes('[Alex]'), 'your own lines are drawn as they are')
    a.type('\x1d')
    const r = await a.closed()
    assert.equal(r.code, 0, r.out)
    assert.match(r.out, /detached · the workspace keeps running · handover written/)
    assert.ok(!r.out.includes(SECRET))
  } finally { await host.close() }
})


const tmuxBin = (process.env.PATH || '').split(path.delimiter).map((dir) => path.join(dir, 'tmux')).find((p) => fs.existsSync(p))

test('in a real terminal: the size said with the attach and again when it changes, the wheel and Shift-PageUp scroll the view (never sent as keys), and Ctrl-] gives the terminal back: raw mode off, mouse reporting off, the cursor shown, the screen as it was', { skip: !tmuxBin && 'no tmux here' }, async () => {
  const host = await fakeHost()
  const SOCKET = `atelier-cli-attach-test-${process.pid}`
  const T = (...a) => execFileSync(tmuxBin, ['-L', SOCKET, ...a], { encoding: 'utf8' })
  const until = async (what, ok, ms = 4000) => {
    for (const end = Date.now() + ms; !ok(); await new Promise((r) => setTimeout(r, 30)))
      if (Date.now() > end) throw new Error(`waited for ${what}; the pane:\n${T('capture-pane', '-p', '-t', '=cli:')}`)
  }
  try {
    const home = signedInHome(host.url)
    // the CLI in a pane of 100×30; after it exits the shell prints the terminal's line settings, then waits to be looked at
    T('new-session', '-d', '-s', 'cli', '-x', '100', '-y', '30', '-e', `HOME=${home}`, '-e', 'XDG_CONFIG_HOME=', '--', 'sh', '-c',
      `"${process.execPath}" "${CLI}" attach --host ${host.url}; stty -a | tr ' ' '\\n' | grep -E '^-?(icanon|echo)$' | tr '\\n' ' '; echo '<- the line settings'; sleep 30`)
    await until('the first frame', () => T('capture-pane', '-p', '-t', '=cli:').includes('fake agent · pid 42'))
    // the rows it gives the pane are the terminal's less the footer's one
    assert.deepEqual(host.calls.find((c) => c.url === '/api/attach').body.size, { cols: 100, rows: 29 })
    assert.equal(T('display-message', '-p', '-t', '=cli:', '#{alternate_on} #{mouse_standard_flag} #{mouse_sgr_flag}').trim(), '1 1 1')
    T('resize-window', '-t', '=cli:', '-x', '80', '-y', '20')
    await until('the new size said', () => host.views.some((v) => v.size?.cols === 80 && v.size?.rows === 19))
    // Shift-PageUp: a page (the screen less the footer, less one); the wheel up: three rows; neither is a key for the pane
    T('send-keys', '-t', '=cli:', '-H', '1b', '5b', '35', '3b', '32', '7e')
    await until('a page up', () => host.views.some((v) => v.scroll === 18))
    await until('the footer says it', () => T('capture-pane', '-p', '-t', '=cli:').includes('scrollback: 18 of 100 rows up'))
    T('send-keys', '-t', '=cli:', '-H', ...[...'\x1b[<64;10;5M'].map((c) => c.charCodeAt(0).toString(16)))
    await until('the wheel up', () => host.views.some((v) => v.scroll === 3))
    T('send-keys', '-t', '=cli:', '-l', 'echo hi')
    T('send-keys', '-t', '=cli:', '-H', '0d')
    await until('the keys', () => host.keys.join('') === 'echo hi\r')
    T('send-keys', '-t', '=cli:', '-H', '1d')   // Ctrl-]
    await until('the terminal given back', () => T('capture-pane', '-p', '-t', '=cli:').includes('<- the line settings'))
    const after = T('capture-pane', '-p', '-t', '=cli:')
    assert.match(after, /detached · the workspace keeps running · handover written/)
    assert.match(after, /^icanon echo <- the line settings$/m, 'raw mode off: canonical input and echo again')
    assert.equal(T('display-message', '-p', '-t', '=cli:', '#{alternate_on} #{cursor_flag} #{mouse_standard_flag} #{mouse_sgr_flag}').trim(), '0 1 0 0',
      'its own screen back, the cursor shown, the mouse no longer reported')
    assert.ok(!host.keys.join('').includes('\x1b'), 'no gesture reached the pane as keys')
    assert.ok(!after.includes(SECRET))
  } finally {
    try { T('kill-server') } catch {}
    await host.close()
  }
})

/* What the CLI drew last: the footer's text (the reverse-video row), and the screen rows of the last frame, both without
 * their escape sequences. */
const plain = (s) => s.replace(/\x1b\[[0-9;?<]*[ -/]*[@-~]/g, '')
const lastFooter = (out) => plain([...out.matchAll(/\x1b\[7m(.*?)\x1b\[0m/g)].at(-1)?.[1] ?? '').trim()
const lastRows = (out) => plain(out.split('\x1b[?25l').at(-1) ?? '')

test('the wheel scrolls the view three rows a notch on the agent\'s session as on the shell, watching or not, never as a key, with a click dropped, the footer saying how far up, new output never pulling the view down, and the bottom following the pane again', async () => {
  for (const [verb, args] of [[['agent', 'attach'], ['--watch']], [['attach'], []]]) {
    const host = await fakeHost({ handover: false })
    try {
      const a = attach(signedInHome(host.url), ['/main', ...args, '--host', host.url], verb)
      await a.until('the first frame', () => a.out.includes('fake agent · pid 42'))
      // one notch up (SGR button 64), as Ghostty and every terminal send it once the CLI turned on ?1000h ?1006h
      a.type('\x1b[<64;10;10M')
      await a.until('a scroll of 3', () => host.views.some((v) => v.scroll === 3))
      await a.until('the footer says it', () => lastFooter(a.out).includes('scrollback: 3 of 100 rows up'))
      await new Promise((r) => setTimeout(r, 60))
      a.type('\x1b[<64;10;10M')
      await a.until('3 more', () => host.views.filter((v) => v.scroll === 3).length === 2)
      await a.until('6 up', () => lastFooter(a.out).includes('scrollback: 6 of 100 rows up'))
      assert.ok(lastRows(a.out).includes('scrollback row 94'), 'the view drawn from where it is')
      // a click (button 0) is the terminal's, never a key for the pane, never a scroll
      a.type('\x1b[<0;10;10M\x1b[<0;10;10m')
      // the pane writes on: the view stays on its rows, only further up
      host.write(5, 'new output at the bottom')
      await a.until('further up', () => lastFooter(a.out).includes('scrollback: 11 of 105 rows up'))
      assert.ok(!lastRows(a.out).includes('new output at the bottom'), 'not pulled down to the new line')
      assert.ok(lastRows(a.out).includes('scrollback row 94'), 'the same rows as before')
      // down, notch by notch, to the bottom: the view follows the pane again
      for (let i = 0; i < 4; i++) { a.type('\x1b[<65;10;10M'); await new Promise((r) => setTimeout(r, 60)) }
      await a.until('the bottom', () => !lastFooter(a.out).includes('scrollback'))
      assert.ok(lastRows(a.out).includes('new output at the bottom'), 'the pane as it is now')
      assert.deepEqual(host.views.filter((v) => 'scroll' in v).map((v) => v.scroll), [3, 3, -3, -3, -3, -3])
      assert.equal(host.keys.length, 0, 'no gesture reached the pane as keys')
      a.type('\x1d')
      const r = await a.closed()
      assert.equal(r.code, 0, r.out)
    } finally { await host.close() }
  }
})

test('a screen that keeps no scrollback (its program on the alternate screen): the wheel up is answered with the bridge\'s sentence, shown in the footer, never a wheel that silently does nothing', { skip: !tmuxBin && 'no tmux here' }, async () => {
  const host = await fakeHost({ handover: false, history: 0 })
  const SOCKET = `atelier-cli-wheel-test-${process.pid}`
  const T = (...a) => execFileSync(tmuxBin, ['-L', SOCKET, ...a], { encoding: 'utf8' })
  const until = async (what, ok, ms = 4000) => {
    for (const end = Date.now() + ms; !ok(); await new Promise((r) => setTimeout(r, 30)))
      if (Date.now() > end) throw new Error(`waited for ${what}; the pane:\n${T('capture-pane', '-p', '-t', '=cli:')}`)
  }
  try {
    const home = signedInHome(host.url)
    // a terminal wide enough for the whole footer
    T('new-session', '-d', '-s', 'cli', '-x', '200', '-y', '20', '-e', `HOME=${home}`, '-e', 'XDG_CONFIG_HOME=', '--', 'sh', '-c',
      `"${process.execPath}" "${CLI}" agent attach --watch --host ${host.url}; sleep 30`)
    await until('the first frame', () => T('capture-pane', '-p', '-t', '=cli:').includes('fake agent · pid 42'))
    T('send-keys', '-t', '=cli:', '-H', ...[...'\x1b[<64;10;5M'].map((c) => c.charCodeAt(0).toString(16)))
    await until('the sentence in the footer', () => T('capture-pane', '-p', '-t', '=cli:').includes('nothing to scroll back to: the program on this screen keeps its history itself'))
    assert.ok(!T('capture-pane', '-p', '-t', '=cli:').includes('scrollback:'))
    assert.deepEqual(host.views.filter((v) => 'scroll' in v), [{ scroll: 3 }])
  } finally {
    try { T('kill-server') } catch {}
    await host.close()
  }
})

test('run on its own, agent-attach.js asks for the agent\'s session and attach.js for the workspace\'s shell', async () => {
  const host = await fakeHost({ handover: false })
  try {
    for (const [file, onto] of [['agent-attach.js', 'agent'], ['attach.js', 'shell']]) {
      const a = running([path.resolve(HERE, '..', file), '--watch', '--host', host.url], signedInHome(host.url))
      await a.until('the first frame', () => a.out.includes('fake agent · pid 42'))
      assert.equal(host.calls.filter((c) => c.url === '/api/attach').at(-1).body.onto, onto, file)
      a.type('\x1d')
      assert.equal((await a.closed()).code, 0, file)
    }
  } finally { await host.close() }
})

test('the keys that stop a program never reach the agent\'s session while the shell gets every key as typed', async () => {
  const typed = 'a\x03b\x04c\x1ad\x1ce\r'
  for (const [verb, sent] of [[['agent', 'attach'], 'abcde\r'], [['attach'], typed]]) {
    const host = await fakeHost()
    try {
      const a = attach(signedInHome(host.url), ['k1/main', '--host', host.url], verb)
      await a.until('the first frame', () => a.out.includes('fake agent · pid 42'))
      a.type(typed)
      await a.until('the keys sent', () => host.keys.join('').endsWith('\r'))
      assert.equal(host.keys.join(''), sent, verb.join(' '))
      a.type('\x1d')
      assert.equal((await a.closed()).code, 0)
    } finally { await host.close() }
  }
})

test('the shell\'s own exit is a way out of attach that exits 0 and leaves the workspace running, while on the agent\'s session it is a closed attach that exits 1', async () => {
  for (const [verb, code, said] of [[['attach'], 0, `detached · ${SHELL_EXITED} · the workspace keeps running`], [['agent', 'attach'], 1, `k1/main closed the attach: ${SHELL_EXITED}`]]) {
    const host = await fakeHost()
    try {
      const a = attach(signedInHome(host.url), ['k1/main', '--host', host.url], verb)
      await a.until('the first frame', () => a.out.includes('fake agent · pid 42'))
      host.closeScreen(SHELL_EXITED)
      const r = await a.closed()
      assert.equal(r.code, code, r.out)
      assert.ok(r.out.includes(said), r.out)
    } finally { await host.close() }
  }
})

test('a screen the host closes before its first frame is a refusal said as the host\'s one sentence with exit 1', async () => {
  const host = await fakeHost({ frameAtOnce: false })
  try {
    const a = attach(signedInHome(host.url), ['k1/main', '--host', host.url])
    await a.until('the screen asked for', () => host.calls.some((c) => c.url.endsWith('/screen')))
    host.closeScreen('the workspace is asleep')
    const r = await a.closed()
    assert.equal(r.code, 1, r.out)
    assert.match(r.out, /atelier agent attach: the workspace is asleep/)
    assert.ok(!r.out.includes('detached'), r.out)
  } finally { await host.close() }
})

test('markedLines puts the name of whoever started a line in front of it and moves the cursor with it, draws a line of yours from any of your terminals as it is, and drops a mark off the screen', () => {
  const frame = {
    lines: ['~ $ ls', '~ $ npm test', '~ $ git st'],
    cursor: { x: 10, y: 2 },
    marks: [
      { attach: 'at-mine', person: 'person:alex', name: 'Alex', row: 0 },
      { attach: 'at-alex-laptop', person: 'person:alex', name: 'Alex', row: 1 },
      { attach: 'at-sam', person: 'person:sam', name: 'Sam', row: 2 },
      { attach: 'at-sam', person: 'person:sam', name: 'Sam', row: 3 },
      { attach: 'at-sam', person: 'person:sam', name: 'Sam', row: -1 },
      null,
    ],
  }
  assert.deepEqual(markedLines(frame, 'at-mine', 'person:alex'), { lines: ['~ $ ls', '~ $ npm test', '[Sam] ~ $ git st'], cursor: { x: 16, y: 2 } })
  assert.deepEqual(frame.lines, ['~ $ ls', '~ $ npm test', '~ $ git st'], 'the frame itself is left as it came')
  assert.deepEqual(markedLines({ ...frame, marks: undefined }, 'at-mine', 'person:alex').lines, frame.lines, 'a frame without marks is drawn as it is')
})
