// atelier run (run.js, through the ops client in ops.js) — a terminal of its own, exercised through the real CLI against an in-process fake of the host's three
// op routes (POST /api/ops, its stream, its /in). In a real terminal (a tmux pane) the CLI asks for a terminal, says its
// size before anything draws, and the fake host draws a full-screen program's first frame at that size (the alternate
// screen, a frame, the cursor home) the way the computer forwards a pane's bytes; a key goes as typed, one byte, no
// newline (raw mode); the program's exit gives the terminal back. On pipes (a script, a file) it asks for none: what is
// piped in goes line by line, its end the command's end of input.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CLI = path.resolve(HERE, '..', 'cli.js')
const SECRET = 'sess_test_5b1e0c9a7d3f4e2a8c6b0d1f3e5a7c9b'
const OP = 'op-0123abcd'

// The fake host: one op. Its stream says started, then waits for what comes in: a size draws the program's first frame at
// that size; `q` ends it (the alternate screen left, the computer's last line, done); keys and eof on pipes are echoed back.
async function fakeHost() {
  const ops = [], ins = []
  let stream = null
  const say = (f) => stream?.write(JSON.stringify(f) + '\n')
  const server = http.createServer(async (req, res) => {
    let raw = ''
    for await (const c of req) raw += c
    const body = raw ? JSON.parse(raw) : {}
    const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }
    if (req.headers.authorization !== `Session ${SECRET}`) return send(401, { refused: 'the session is not valid; sign in again' })
    if (req.method === 'POST' && req.url === '/api/ops') { ops.push(body); return send(201, { op: OP, computer: 'k1' }) }
    if (req.method === 'GET' && req.url === `/api/ops/${OP}/stream`) {
      res.writeHead(200, { 'content-type': 'application/x-ndjson' })
      stream = res
      say({ line: 'running as notes, beside its data' })
      say({ started: true })
      return
    }
    if (req.method === 'POST' && req.url === `/api/ops/${OP}/in`) {
      ins.push(body)
      send(200, { ok: true })
      if (body.size) say({ out: `\x1b[?1049h\x1b[H\x1b[2JFRAME 1 · ${body.size.cols}x${body.size.rows}\r\nq quits` })
      if (body.keys === 'q') { say({ out: '\x1b[?1049l' }); say({ line: 'done · recorded: Alex, a laptop, 09:52' }); say({ done: true, code: 0 }) }
      if (typeof body.keys === 'string' && body.keys !== 'q') say({ out: `heard: ${body.keys}` })
      if (body.eof) { say({ line: 'done · recorded: Alex, a laptop, 09:52' }); say({ done: true, code: 0 }) }
      return
    }
    send(404, { error: 'no such route' })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  return { url: `http://127.0.0.1:${server.address().port}`, ops, ins, close: () => new Promise((r) => { server.closeAllConnections(); server.close(r) }) }
}

/* A signed-in home and a module folder whose remote `atelier` names the fake host's computer k1 and its app notes. */
function moduleAt(host) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-run-'))
  const dir = path.join(home, '.config', 'atelier')
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  fs.writeFileSync(path.join(dir, 'credentials'), JSON.stringify({
    [host]: { session: SECRET, expires: '2099-10-31T12:00:00.000Z', person: { id: 'person:7f3a2c', name: 'Alex' }, network: 'fake', number: '+15555550100' },
  }), { mode: 0o600 })
  const mod = path.join(home, 'notes')
  fs.mkdirSync(mod)
  fs.writeFileSync(path.join(mod, 'module.json'), JSON.stringify({ name: 'notes' }))
  const git = (...a) => execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@localhost', ...a], { cwd: mod, stdio: 'ignore' })
  git('init', '-q'); git('remote', 'add', 'atelier', `${host}/git/k1/notes.git`)
  return { home, mod }
}

const tmuxBin = (process.env.PATH || '').split(path.delimiter).map((dir) => path.join(dir, 'tmux')).find((p) => fs.existsSync(p))

test('from a terminal, atelier run gets a terminal of its own: it asks for one, says its size before anything draws, a full-screen program\'s first frame is drawn at that size, a key goes as typed (raw), and its end gives the terminal back', { skip: !tmuxBin && 'no tmux here' }, async () => {
  const host = await fakeHost()
  const SOCKET = `atelier-cli-run-test-${process.pid}`
  const T = (...a) => execFileSync(tmuxBin, ['-L', SOCKET, ...a], { encoding: 'utf8' })
  const pane = () => T('capture-pane', '-p', '-t', '=cli:')
  const until = async (what, ok, ms = 4000) => {
    for (const end = Date.now() + ms; !ok(); await new Promise((r) => setTimeout(r, 30)))
      if (Date.now() > end) throw new Error(`waited for ${what}; the pane:\n${pane()}`)
  }
  try {
    const { home, mod } = moduleAt(host.url)
    // the CLI in a pane of 100×30; after it exits the shell prints its exit code and the terminal's line settings
    T('new-session', '-d', '-s', 'cli', '-x', '100', '-y', '30', '-c', mod, '-e', `HOME=${home}`, '-e', 'XDG_CONFIG_HOME=', '--', 'sh', '-c',
      `"${process.execPath}" "${CLI}" run -r atelier -- top; echo "exit $?"; stty -a | tr ' ' '\\n' | grep -E '^-?(icanon|echo)$' | tr '\\n' ' '; echo '<- the line settings'; sleep 30`)
    T('set-option', '-t', '=cli:', 'status', 'off')
    await until('the first frame', () => pane().includes('FRAME 1'))
    assert.deepEqual(host.ops[0].op, { verb: 'run', argv: ['top'], tty: true }, 'a terminal asked for')
    assert.deepEqual(host.ins[0], { size: { cols: 100, rows: 30 } }, 'its size first, before anything draws')
    assert.match(pane(), /^FRAME 1 · 100x30$/m, 'the frame drawn at that size, from the top of the screen')
    assert.equal(T('display-message', '-p', '-t', '=cli:', '#{alternate_on}').trim(), '1', 'a full-screen program on the alternate screen')
    // one key, as typed: no Enter needed, nothing added
    T('send-keys', '-t', '=cli:', '-l', 'q')
    await until('the terminal given back', () => pane().includes('<- the line settings'))
    assert.deepEqual(host.ins.filter((x) => 'keys' in x), [{ keys: 'q' }])
    const after = pane()
    assert.match(after, /remote: done · recorded: Alex, a laptop, 09:52\nexit 0/)
    assert.match(after, /^icanon echo <- the line settings$/m, 'raw mode off')
    assert.equal(T('display-message', '-p', '-t', '=cli:', '#{alternate_on} #{cursor_flag}').trim(), '0 1', 'its own screen back, the cursor shown')
    assert.ok(!after.includes(SECRET))
  } finally {
    try { T('kill-server') } catch {}
    await host.close()
  }
})

test('on pipes, atelier run asks for no terminal: what is piped in goes as it comes, its end the command\'s end of input; --tty asks for one anyway, at 80×24 without a terminal to measure', async () => {
  for (const [flags, tty] of [[[], false], [['--tty'], true]]) {
    const host = await fakeHost()
    try {
      const { home, mod } = moduleAt(host.url)
      const env = { ...process.env, HOME: home }
      delete env.ATELIER_HOST; delete env.ATELIER_SOCKET; delete env.ATELIER_SANDBOX; delete env.XDG_CONFIG_HOME
      const p = spawn(process.execPath, [CLI, 'run', '-r', 'atelier', ...flags, '--', 'cat'], { cwd: mod, env, stdio: ['pipe', 'pipe', 'pipe'] })
      let out = '', err = ''
      p.stdout.on('data', (d) => { out += d }); p.stderr.on('data', (d) => { err += d })
      p.stdin.end(tty ? 'q' : 'one line\n')
      const code = await new Promise((r) => p.on('close', r))
      assert.equal(code, 0, err)
      assert.deepEqual(host.ops[0].op, { verb: 'run', argv: ['cat'], ...(tty ? { tty: true } : {}) })
      if (tty) {
        assert.deepEqual(host.ins[0], { size: { cols: 80, rows: 24 } })
        assert.match(out, /FRAME 1 · 80x24/)
      } else {
        assert.deepEqual(host.ins, [{ keys: 'one line\n' }, { eof: true }])
        assert.equal(out, 'heard: one line\n')
      }
      assert.match(err, /remote: done · recorded/)
    } finally { await host.close() }
  }
})
