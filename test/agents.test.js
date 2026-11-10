// atelier agent new (agent.js), its folder (agent-folder.js), the share at birth and the verbs that manage an agent
// (agent-manage.js, agent-host.js) and atelier agents (agents.js) — exercised through the real CLI against a fake of the
// host's op routes, GET /api/agents, GET /api/computers and the agent routes the Agents page uses (share, unshare, rules,
// delete), each answering as core's services/portal/people.ts does: the agent is made by the same op with the same prompt
// as without --here, an agent made on the person's own computer is shared with their own 1:1 by the share route naming
// the chat alone, its id is the one the host's list of the person's agents answers, and the folder holds the agent as
// Claude Code defines one (.claude/agents/<name>.md: front matter, then the prompt), the settings that start it there, and
// one file naming the agent, never the session.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { homeAt, cli } from './adopt-host.js'
import { SECRET } from './files-host.js'
import { AGENT_DESCRIPTION_CHARS } from '../limits.js'

const OP = 'op-5e6f7a8b'
const MADE = 'agent k1/main/reviewer · made · held by the fleet · it answers the chat once `agent primary reviewer` names it'
const PROMPT = '# reviewer\n\nYou read pull requests and say what breaks.\n'
const DESCRIPTION = 'Reads pull requests and says what breaks'
const RULES = 'the rules the fleet holds, never printed'
const REVIEWER = { id: 'agent:9b1c4e', name: 'reviewer' }
const NAMING = '.atelier-agent.json'
const definitionOf = (name) => `.claude/agents/${name}.md`
const SETTINGS = '.claude/settings.json'
const laidOut = (name) => [NAMING, definitionOf(name), SETTINGS].sort()
const ON_MY_WORD = 'on my word'

/* The person's own computer and the 1:1 it serves; a room's computer and its chat; another room the host offers. */
const OWN = { computer: 'computer:k1', label: 'k1', chat: 'chat:0a1b2c', name: 'Alex' }
const TESIS = { computer: 'computer:k2', label: 'tesis', chat: 'chat:7e4a51', name: 'Tesis' }
const LAB = { chat: 'chat:5d6e7f', name: 'Lab' }
const COMPUTERS = [
  { id: OWN.computer, label: OWN.label, kind: 'own', with: null, chat: OWN.chat, chatName: OWN.name, direct: 'person:7f3a2c', line: 'your own', modules: [] },
  { id: TESIS.computer, label: TESIS.label, kind: 'room', with: null, chat: TESIS.chat, chatName: TESIS.name, direct: null, line: 'a room of example-co', modules: [] },
]
/* What the Agents page offers to share with: the chats with a computer that are not the person's own 1:1. */
const CHOICES = { tools: [], apps: [], chats: [{ id: TESIS.chat, name: TESIS.name }, { id: LAB.chat, name: LAB.name }], companies: [], people: [] }
const NAMES = { [OWN.chat]: OWN.name, [TESIS.chat]: TESIS.name, [LAB.chat]: LAB.name }

/* The words of the core's share routes (services/portal/people.ts). */
const NO_SUCH_AGENT = 'there is no such agent here'
const SHARE_REFUSED = 'you can share your own agents, with chats you are in'
const UNSHARE_REFUSED = 'that agent is not shared there, or it is not yours to say'

/* One agent as GET /api/agents answers it; an exposure a name (a chat of that name) or { to, name }. */
const agentOf = ({ id, name, computer = OWN.computer, computerName = OWN.label }, { exposures = [], primary = false } = {}) => ({
  id, name, computer, computerName, tools: [], uses: [], rules: RULES, version: 1,
  exposures: exposures.map((x, i) => ({ to: x.to ?? `chat:c${i}`, name: x.name ?? x, mode: ON_MY_WORD, also: [], draft: false })), sandboxes: [],
  ...(primary ? { primary: true } : {}),
})

/* The host at `url`: the ops asked are kept in `asked`, what goes into them in `ins`, each GET of the person's agents in
 * `lists`, each POST to an agent's route in `posts` ({ verb, agent, body }). An agent-new op ends once its prompt went in,
 * as the computer's does: `MADE` and `code`; on code 0 the agent `made` joins the person's agents (none: the host made it
 * and does not list it). `refuseShare`: the sentence a share is refused with (403), as the kernel refuses one. */
async function agentsHost({ agents = [], code = 0, made = REVIEWER, computers = COMPUTERS, refuseShare = null } = {}) {
  const asked = [], ins = [], lists = [], posts = [], listed = [...agents]
  let stream = null
  const server = http.createServer(async (req, res) => {
    const chunks = []
    for await (const c of req) chunks.push(c)
    const raw = Buffer.concat(chunks).toString('utf8')
    const body = raw ? JSON.parse(raw) : {}
    const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }
    const say = (f) => stream.write(JSON.stringify(f) + '\n')
    if (req.headers.authorization !== `Session ${SECRET}`) return send(401, { refused: 'the session is not valid; sign in again' })
    if (req.method === 'POST' && req.url === '/api/ops') { asked.push(body); return send(201, { op: OP, computer: body.computer ?? 'k1' }) }
    if (req.method === 'GET' && req.url === `/api/ops/${OP}/stream`) {
      res.writeHead(200, { 'content-type': 'application/x-ndjson' })
      stream = res
      return say({ started: true })
    }
    if (req.method === 'POST' && req.url === `/api/ops/${OP}/in`) {
      ins.push(body)
      send(200, { ok: true })
      if (code === 0 && made) listed.push(agentOf(made))
      say({ line: code === 0 ? MADE : 'an agent has a name and a system prompt' })
      say({ done: true, code })
      return stream.end()
    }
    if (req.method === 'GET' && req.url === '/api/agents') { lists.push(req.url); return send(200, { agents: listed, choices: CHOICES }) }
    if (req.method === 'GET' && req.url === '/api/computers') return send(200, { computers, sleepChoices: [] })
    const route = /^\/api\/agents\/([^/]+)\/(share|unshare|rules|delete)$/.exec(req.url)
    if (req.method === 'POST' && route) {
      const [, part, verb] = route, agent = decodeURIComponent(part), a = listed.find((x) => x.id === agent)
      posts.push({ verb, agent, body })
      if (verb === 'share' || verb === 'unshare') {
        if (!/^(?:chat|company|person):/.test(body.to ?? '')) return send(400, { refused: 'shared with a chat, a company or a person' })
        const at = a ? a.exposures.findIndex((x) => x.to === body.to) : -1
        if (verb === 'unshare') {
          if (at < 0) return send(403, { refused: UNSHARE_REFUSED })
          a.exposures.splice(at, 1)
          return send(200, { ok: true, id: 'grant:2b3c4d' })
        }
        if (!a || refuseShare || !(body.to in NAMES)) return send(403, { refused: refuseShare ?? SHARE_REFUSED })
        if (at < 0) a.exposures.push({ to: body.to, name: NAMES[body.to], mode: body.mode ?? ON_MY_WORD, also: body.also ?? [], draft: body.draft === true })
        return send(201, { ok: true, id: 'grant:1a2b3c' })
      }
      if (!a) return send(404, { refused: NO_SUCH_AGENT })
      if (verb === 'rules') {
        if (typeof body.rules !== 'string' || !body.rules.trim()) return send(400, { refused: 'the system prompt is your own words' })
        a.version += 1
        return send(200, { version: a.version })
      }
      listed.splice(listed.indexOf(a), 1)
      return send(200, { ok: true })
    }
    send(404, { error: 'no such route' })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  return { url: `http://127.0.0.1:${server.address().port}`, asked, ins, lists, posts, listed, close: () => new Promise((r) => { server.closeAllConnections(); server.close(r) }) }
}

/* A home signed in at the host, holding the prompt file. */
const homeWithPrompt = (url, prompt = PROMPT) => {
  const home = homeAt(url)
  fs.writeFileSync(path.join(home, 'reviewer.md'), prompt)
  return home
}

const remoteLines = (err) => err.split('\n').filter((l) => l.startsWith('remote: '))
const lines = (out) => out.split('\n').filter((l) => l.trim())

/* Every file under `dir`, by its path from there, sorted; folders only by the files they hold. */
const filesIn = (dir) => fs.readdirSync(dir, { recursive: true }).filter((f) => fs.statSync(path.join(dir, f)).isFile()).sort()

const ESCAPES = { 0: '\0', a: '\x07', b: '\b', t: '\t', '\t': '\t', n: '\n', v: '\v', f: '\f', r: '\r', e: '\x1b', ' ': ' ', '"': '"', '/': '/', '\\': '\\', N: '\x85', _: '\xa0', L: '\u2028', P: '\u2029' }
const NOT_A_STRING = /^(?:~|null|Null|NULL|true|True|TRUE|false|False|FALSE|y|Y|yes|Yes|YES|n|N|no|No|NO|on|On|ON|off|Off|OFF|[-+]?(?:\d[\d_]*(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?|0x[0-9a-fA-F]+|0o[0-7]+|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$/

/* One scalar of a `key: value` line as a YAML parser reads it: double-quoted with its escapes, single-quoted, or plain.
 * A plain one ends at a ` #` comment, holds no `: `, starts with no indicator, and is a string only when it is no null,
 * boolean or number of YAML 1.1 or 1.2; anything else is answered as { notAString } and fails the comparison. */
function scalar(raw) {
  if (raw.startsWith('"')) {
    const m = /^"((?:[^"\\]|\\.)*)"[ \t]*(?:#.*)?$/.exec(raw)
    assert.ok(m, `not one double-quoted scalar: ${raw}`)
    return m[1].replace(/\\(?:x([0-9a-fA-F]{2})|u([0-9a-fA-F]{4})|U([0-9a-fA-F]{8})|(.))/g, (_, x, u, U, c) => {
      const hex = x ?? u ?? U
      if (hex) return String.fromCodePoint(parseInt(hex, 16))
      assert.ok(c in ESCAPES, `\\${c} is no YAML escape`)
      return ESCAPES[c]
    })
  }
  if (raw.startsWith("'")) {
    const m = /^'((?:[^']|'')*)'[ \t]*(?:#.*)?$/.exec(raw)
    assert.ok(m, `not one single-quoted scalar: ${raw}`)
    return m[1].replace(/''/g, "'")
  }
  const value = raw.replace(/[ \t]#.*$/, '').trim()
  if (!value || /^[-?:,[\]{}#&*!|>'"%@`]/.test(value) || /:(?:[ \t]|$)/.test(value) || NOT_A_STRING.test(value)) return { notAString: raw }
  return value
}

/* A definition of Claude Code's read as it is split: its first line `---`, its front matter up to the next line `---` as
 * `key: value` lines, and its body, the bytes after that line. */
function definitionIn(file) {
  const bytes = fs.readFileSync(file)
  const text = bytes.toString('utf8')
  const all = text.split('\n')
  assert.equal(all[0], '---', 'the first line opens the front matter')
  const close = all.indexOf('---', 1)
  assert.ok(close > 0, 'the front matter is closed')
  const fields = {}
  for (const line of all.slice(1, close)) {
    const m = /^([A-Za-z]+):[ \t](.*)$/.exec(line)
    assert.ok(m, `not one key: value line: ${JSON.stringify(line)}`)
    assert.ok(!(m[1] in fields), `${m[1]} twice`)
    fields[m[1]] = scalar(m[2])
  }
  return { fields, body: bytes.subarray(Buffer.byteLength(all.slice(0, close + 1).join('\n') + '\n')) }
}

/* What agent new says once the agent made on your own computer is shared with your own 1:1, and once its folder is laid out. */
const BORN = 'agent reviewer · shared with your 1:1: your agent there may ask it'
const FOLDER = 'folder ./reviewer/ · .claude/agents/reviewer.md defines it · start it: cd reviewer && claude · or there: claude --agent reviewer'
const newHere = (url, name = 'reviewer', more = []) => ['agent', 'new', name, '--prompt', 'reviewer.md', '--here', '--description', DESCRIPTION, ...more, '--host', url]

test('agent new --here makes and shares the agent as without it, then lays out ./<name>/ as Claude Code\'s agent (definition, settings, a naming file without the session) and says how to start it', async () => {
  const runs = {}
  for (const here of [false, true]) {
    const host = await agentsHost(), home = homeWithPrompt(host.url)
    try {
      const r = await cli(home, here ? newHere(host.url) : ['agent', 'new', 'reviewer', '--prompt', 'reviewer.md', '--host', host.url])
      assert.equal(r.code, 0, r.err)
      const folder = path.join(home, 'reviewer')
      runs[here] = { asked: host.asked, ins: host.ins, posts: host.posts, err: r.err, out: r.out, folder: fs.existsSync(folder) }
      if (!here) continue
      assert.deepEqual(filesIn(folder), laidOut('reviewer'), 'no CLAUDE.md: the definition, the settings, the naming file')
      const { fields, body } = definitionIn(path.join(folder, definitionOf('reviewer')))
      assert.deepEqual(fields, { name: 'reviewer', description: DESCRIPTION })
      assert.deepEqual(body, Buffer.from(PROMPT))
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(folder, SETTINGS), 'utf8')), { agent: 'reviewer' })
      const naming = JSON.parse(fs.readFileSync(path.join(folder, NAMING), 'utf8'))
      assert.deepEqual(Object.keys(naming).sort(), ['host', 'id', 'made', 'name'])
      assert.deepEqual([naming.id, naming.name, naming.host], [REVIEWER.id, 'reviewer', host.url])
      assert.ok(!Number.isNaN(Date.parse(naming.made)), naming.made)
      assert.equal(fs.statSync(path.join(folder, NAMING)).mode & 0o777, 0o600)
      for (const f of filesIn(folder)) assert.ok(!fs.readFileSync(path.join(folder, f), 'utf8').includes(SECRET), `${f} holds the session`)
    } finally { await host.close(); fs.rmSync(home, { recursive: true, force: true }) }
  }
  const [without, withHere] = [runs[false], runs[true]]
  assert.deepEqual(withHere.asked, without.asked, 'the same op: the description is the folder\'s alone')
  assert.deepEqual(withHere.ins, without.ins, 'the same prompt')
  assert.deepEqual(without.ins, [{ prompt: PROMPT }])
  assert.deepEqual(remoteLines(withHere.err), [`remote: ${MADE}`])
  assert.equal(withHere.err, without.err)
  assert.deepEqual(withHere.posts, without.posts, 'the same share at birth')
  assert.deepEqual([without.folder, lines(without.out)], [false, [BORN]], 'without --here: no folder, the share said')
  assert.deepEqual(lines(withHere.out), [BORN, FOLDER])
})

test('the definition\'s body is the prompt file byte for byte, also one with front matter of its own and a line --- or no last newline, and a name YAML reads as no string (null, no) is still the name', async () => {
  const cases = [
    ['null', '---\nname: impostor\ndescription: not this one\n---\nYou review.\n---\nand one more line.\n'],
    ['no', 'You review, and the last line has no newline: ---'],
  ]
  for (const [name, prompt] of cases) {
    const host = await agentsHost({ made: { id: `agent:${name}`, name } }), home = homeWithPrompt(host.url, prompt)
    try {
      const r = await cli(home, newHere(host.url, name))
      assert.equal(r.code, 0, r.err)
      const folder = path.join(home, name)
      assert.deepEqual(filesIn(folder), laidOut(name))
      const { fields, body } = definitionIn(path.join(folder, definitionOf(name)))
      assert.deepEqual(fields, { name, description: DESCRIPTION })
      assert.deepEqual(body, fs.readFileSync(path.join(home, 'reviewer.md')))
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(folder, SETTINGS), 'utf8')), { agent: name })
    } finally { await host.close(); fs.rmSync(home, { recursive: true, force: true }) }
  }
})

test('a description with a colon, quotes, a # and a backslash, and a model as written, read back by a YAML reading unchanged', async () => {
  const description = 'Reviews pull requests: says "what breaks" #1, it\'s a C:\\ path too'
  const model = 'claude-opus-4-1'
  const host = await agentsHost(), home = homeWithPrompt(host.url)
  try {
    const args = ['agent', 'new', 'reviewer', '--prompt', 'reviewer.md', '--here', '--description', description, '--model', model, '--host', host.url]
    const r = await cli(home, args)
    assert.equal(r.code, 0, r.err)
    const { fields, body } = definitionIn(path.join(home, 'reviewer', definitionOf('reviewer')))
    assert.deepEqual(fields, { name: 'reviewer', description, model })
    assert.deepEqual(body, Buffer.from(PROMPT))
    assert.deepEqual(host.ins, [{ prompt: PROMPT }], 'neither the description nor the model goes to the host')
    assert.ok(!JSON.stringify(host.asked).includes(model))
  } finally { await host.close(); fs.rmSync(home, { recursive: true, force: true }) }
})

test('agent new --here with no --description, or one empty, of two lines, with a control character, starting with a dash or too long, or a model of two lines, is written wrongly: exit 2 with the usage', async () => {
  const host = await agentsHost(), home = homeWithPrompt(host.url)
  const base = ['agent', 'new', 'reviewer', '--prompt', 'reviewer.md', '--here']
  const cases = [
    [[], /--here defines the agent for Claude Code, which skips a definition without one: --description "<one line>"/],
    [['--description', ''], /--description: one line of printable characters/],
    [['--description', '   '], /--description: one line of printable characters/],
    [['--description', 'two\nlines'], /--description: one line of printable characters/],
    [['--description', 'a bell\x07'], /--description: one line of printable characters/],
    [['--description', 'a line\u2028and another'], /--description: one line of printable characters/],
    [['--description', 'no character of YAML\ufffe'], /--description: one line of printable characters/],
    [['--description', 'no character of YAML\uffff'], /--description: one line of printable characters/],
    [['--description', 'a byte order mark\ufeff inside'], /--description: one line of printable characters/],
    [['--description', `x${'y'.repeat(AGENT_DESCRIPTION_CHARS)}`], new RegExp(`--description: one line of printable characters, at most ${AGENT_DESCRIPTION_CHARS}`)],
    [['--description', '-starts with a dash'], /--description needs <line>/],
    [['--description', DESCRIPTION, '--model', 'two\nlines'], /--model: one line of printable characters/],
  ]
  try {
    for (const [more, said] of cases) {
      const r = await cli(home, [...base, ...more, '--host', host.url])
      assert.equal(r.code, 2, `${JSON.stringify(more)}: ${r.err}`)
      assert.match(r.err, said)
      assert.match(r.err, /usage: atelier agent/)
    }
    assert.deepEqual([host.asked, host.lists], [[], []], 'the host was asked nothing')
    assert.equal(fs.existsSync(path.join(home, 'reviewer')), false)
    const longest = await cli(home, [...base, '--description', 'y'.repeat(AGENT_DESCRIPTION_CHARS), '--host', host.url])
    assert.equal(longest.code, 0, longest.err)
  } finally { await host.close(); fs.rmSync(home, { recursive: true, force: true }) }
})

test('--description and --model without --here are written wrongly, as they are written in the folder alone: exit 2, the host asked nothing', async () => {
  const host = await agentsHost(), home = homeWithPrompt(host.url)
  try {
    for (const more of [['--description', DESCRIPTION], ['--model', 'sonnet']]) {
      const r = await cli(home, ['agent', 'new', 'reviewer', '--prompt', 'reviewer.md', ...more, '--host', host.url])
      assert.equal(r.code, 2, r.err)
      assert.match(r.err, new RegExp(`${more[0]} is written in the agent's folder alone: with --here`))
    }
    assert.deepEqual([host.asked, host.lists], [[], []])
    assert.equal(fs.existsSync(path.join(home, 'reviewer')), false)
  } finally { await host.close(); fs.rmSync(home, { recursive: true, force: true }) }
})

test('agent new --here refuses a ./<name> that is a file or a folder that is not empty, before asking the host anything and touching nothing, and takes an empty folder', async () => {
  const host = await agentsHost(), home = homeWithPrompt(host.url)
  const folder = path.join(home, 'reviewer')
  const run = () => cli(home, newHere(host.url))
  try {
    fs.mkdirSync(folder)
    fs.writeFileSync(path.join(folder, 'notes.md'), 'mine')
    const full = await run()
    assert.equal(full.code, 2, full.err)
    assert.match(full.err, /\.\/reviewer\/ is not empty/)
    assert.deepEqual(fs.readdirSync(folder), ['notes.md'])
    fs.rmSync(folder, { recursive: true })
    fs.writeFileSync(folder, 'a file')
    const file = await run()
    assert.equal(file.code, 2, file.err)
    assert.match(file.err, /\.\/reviewer\/ is not a folder/)
    assert.deepEqual([host.asked, host.lists], [[], []], 'the host was asked nothing')
    fs.rmSync(folder)
    fs.mkdirSync(folder)
    const empty = await run()
    assert.equal(empty.code, 0, empty.err)
    assert.deepEqual(filesIn(folder), laidOut('reviewer'))
  } finally { await host.close(); fs.rmSync(home, { recursive: true, force: true }) }
})

test('agent new shares nothing and lays out nothing when the op fails, and says the agent was made but neither shared nor given its folder when the host does not list it', async () => {
  const plain = ['agent', 'new', 'reviewer', '--prompt', 'reviewer.md']
  const cases = [
    [{ code: 1 }, true, /remote: an agent has a name and a system prompt/],
    [{ made: null }, true, /agent reviewer was made, but the host does not list it: not shared with your 1:1, no folder laid out · atelier agents/],
    [{ made: null }, false, /agent reviewer was made, but the host does not list it: not shared with your 1:1 · atelier agents/],
  ]
  for (const [opts, here, said] of cases) {
    const host = await agentsHost(opts), home = homeWithPrompt(host.url)
    try {
      const r = await cli(home, here ? newHere(host.url) : [...plain, '--host', host.url])
      assert.equal(r.code, 1, r.err)
      assert.match(r.err, said)
      assert.deepEqual(host.posts, [], 'nothing shared')
      assert.equal(fs.existsSync(path.join(home, 'reviewer')), false)
    } finally { await host.close(); fs.rmSync(home, { recursive: true, force: true }) }
  }
})

test('agent new --here without --prompt is written wrongly, before asking the host anything', async () => {
  const host = await agentsHost(), home = homeWithPrompt(host.url)
  try {
    const r = await cli(home, ['agent', 'new', 'reviewer', '--here', '--description', DESCRIPTION, '--host', host.url])
    assert.equal(r.code, 2, r.err)
    assert.match(r.err, /--here writes its prompt as the body of \.claude\/agents\/reviewer\.md: --prompt <file>/)
    assert.deepEqual(host.asked, [])
    assert.equal(fs.existsSync(path.join(home, 'reviewer')), false)
  } finally { await host.close(); fs.rmSync(home, { recursive: true, force: true }) }
})

test('atelier agents lists each agent in one line: its name, whether it is the primary of your 1:1, where it may be asked from with your 1:1 so said, its folder on this machine, never its prompt', async () => {
  const ALEX = { id: 'agent:1a2b3c', name: 'Alex\'s Bayard' }, SCOUT = { id: 'agent:4d5e6f', name: 'scout' }, DRAFTER = { id: 'agent:7a8b9c', name: 'drafter' }
  const host = await agentsHost({ agents: [agentOf(ALEX, { primary: true }), agentOf(REVIEWER, { exposures: [{ to: OWN.chat, name: OWN.name }, 'Sam', 'example-co'] }), agentOf(SCOUT), agentOf(DRAFTER)] })
  const home = homeAt(host.url)
  const lay = (name, naming) => { fs.mkdirSync(path.join(home, name)); fs.writeFileSync(path.join(home, name, NAMING), JSON.stringify(naming)) }
  try {
    lay('reviewer', { ...REVIEWER, host: host.url, made: '2026-11-10T10:00:00.000Z' })
    lay('scout', { ...SCOUT, host: 'http://elsewhere.example', made: '2026-11-10T10:00:00.000Z' })
    lay('drafter', { id: 'agent:000000', name: 'drafter', host: host.url, made: '2026-11-10T10:00:00.000Z' })
    const beside = await cli(home, ['agents', '--host', host.url])
    assert.equal(beside.code, 0, beside.err)
    assert.deepEqual(lines(beside.out), [
      '  Alex\'s Bayard   primary of your 1:1 · asked from nowhere',
      '  reviewer        asked from your 1:1, Sam, example-co · folder ./reviewer/',
      '  scout           asked from nowhere',
      '  drafter         asked from nowhere',
    ])
    assert.ok(!beside.out.includes(RULES))
    const inside = await cli(home, ['agents', '--host', host.url], { cwd: path.join(home, 'reviewer') })
    assert.equal(inside.code, 0, inside.err)
    assert.equal(lines(inside.out)[1], '  reviewer        asked from your 1:1, Sam, example-co · folder here')
    assert.deepEqual(host.asked, [], 'no op: the list is the host\'s')
  } finally { await host.close(); fs.rmSync(home, { recursive: true, force: true }) }
})

test('atelier agents says when there are none, and not signed in at the host is exit 3', async () => {
  const host = await agentsHost(), home = homeAt(host.url)
  try {
    const none = await cli(home, ['agents', '--host', host.url])
    assert.equal(none.code, 0, none.err)
    assert.deepEqual(lines(none.out), ['  no agents yet'])
    const other = await cli(home, ['agents', '--host', 'http://127.0.0.1:1'])
    assert.equal(other.code, 3, other.err)
    assert.match(other.err, /not signed in at http:\/\/127\.0\.0\.1:1/)
  } finally { await host.close(); fs.rmSync(home, { recursive: true, force: true }) }
})

test('inside a sandbox atelier agents, agent new --here, agent share, unshare, rm and rules are a machine\'s: refused with exit 1 before the socket or the host is asked, nothing laid out', async () => {
  const host = await agentsHost(), home = homeWithPrompt(host.url)
  const env = { ATELIER_SOCKET: path.join(home, 'nowhere.sock'), ATELIER_SANDBOX: 'sandbox:3d9f04' }
  try {
    for (const [args, said] of [[['agents'], /inside a sandbox the agents are the fleet's: atelier agents is a machine's/],
      [['agent', 'new', 'reviewer', '--prompt', 'reviewer.md', '--here', '--description', DESCRIPTION], /inside a sandbox there is no folder of a machine: agent new --here is a machine's/],
      ...[['share', 'reviewer'], ['unshare', 'reviewer', 'Tesis'], ['rm', 'reviewer'], ['rules', 'reviewer', '--prompt', 'reviewer.md']].map((more) =>
        [['agent', ...more], new RegExp(`inside a sandbox the agents are the fleet's: atelier agent ${more[0]} is a machine's`)])]) {
      const r = await cli(home, [...args, '--host', host.url], { env })
      assert.equal(r.code, 1, r.err)
      assert.match(r.err, said)
      assert.ok(!r.err.includes('socket'), r.err)
    }
    assert.deepEqual([host.asked, host.lists, host.posts], [[], [], []])
    assert.equal(fs.existsSync(path.join(home, 'reviewer')), false)
  } finally { await host.close(); fs.rmSync(home, { recursive: true, force: true }) }
})

test('agent new shares the agent made on your own computer with your own 1:1 by the share route naming the chat alone, says so in one line, and atelier agents then says your 1:1', async () => {
  const host = await agentsHost(), home = homeWithPrompt(host.url)
  try {
    const r = await cli(home, ['agent', 'new', 'reviewer', '--prompt', 'reviewer.md', '--host', host.url])
    assert.equal(r.code, 0, r.err)
    assert.deepEqual(lines(r.out), [BORN])
    assert.deepEqual(host.posts, [{ verb: 'share', agent: REVIEWER.id, body: { to: OWN.chat } }], 'no mode, no holds: the route\'s own, on my word and nothing held')
    assert.deepEqual(host.listed[0].exposures.map((x) => [x.to, x.mode]), [[OWN.chat, ON_MY_WORD]])
    const listed = await cli(home, ['agents', '--host', host.url])
    assert.deepEqual(lines(listed.out), ['  reviewer   asked from your 1:1'])
  } finally { await host.close(); fs.rmSync(home, { recursive: true, force: true }) }
})

test('when the share at birth is refused the agent stays made and its folder is laid out, and the line says it is not yet askable from your 1:1, why, and the verb that shares it: exit 1', async () => {
  const why = 'the kernel does not answer now'
  for (const here of [false, true]) {
    const host = await agentsHost({ refuseShare: why }), home = homeWithPrompt(host.url)
    try {
      const r = await cli(home, here ? newHere(host.url) : ['agent', 'new', 'reviewer', '--prompt', 'reviewer.md', '--host', host.url])
      assert.equal(r.code, 1, r.err)
      assert.match(r.err, new RegExp(`agent reviewer was made, but it is not shared with your 1:1 \\(${why}\\): your agent there may not ask it yet · atelier agent share reviewer\\n`))
      assert.deepEqual(host.listed.map((a) => a.id), [REVIEWER.id], 'the agent stays made')
      assert.deepEqual(lines(r.out), here ? [FOLDER] : [])
      assert.equal(fs.existsSync(path.join(home, 'reviewer', NAMING)), here)
    } finally { await host.close(); fs.rmSync(home, { recursive: true, force: true }) }
  }
})

test('agent new on a computer that is not your own shares nothing at birth and says where the agent lives and the verb that shares it with a chat', async () => {
  const host = await agentsHost({ made: { ...REVIEWER, computer: TESIS.computer, computerName: TESIS.label } }), home = homeWithPrompt(host.url)
  try {
    const r = await cli(home, ['agent', 'new', 'reviewer', '--prompt', 'reviewer.md', 'tesis/main', '--host', host.url])
    assert.equal(r.code, 0, r.err)
    assert.deepEqual(host.posts, [])
    assert.deepEqual(lines(r.out), ['agent reviewer lives on tesis, not your own computer: shared with no chat yet · atelier agent share reviewer <chat>'])
  } finally { await host.close(); fs.rmSync(home, { recursive: true, force: true }) }
})

test('agent share and unshare name your own 1:1 when no chat is given or it is named your 1:1 as atelier agents says it, a chat the host offers by its name or its id, and post nothing when it is already so', async () => {
  const host = await agentsHost({ agents: [agentOf(REVIEWER)] }), home = homeAt(host.url)
  const run = (...args) => cli(home, ['agent', ...args, '--host', host.url])
  try {
    const steps = [
      [['share', 'reviewer'], 'agent reviewer · shared with your 1:1: your agent there may ask it', { verb: 'share', to: OWN.chat }],
      [['share', 'reviewer', 'your 1:1'], 'agent reviewer · already shared with your 1:1: nothing changed', null],
      [['share', 'reviewer', 'Tesis'], 'agent reviewer · shared with Tesis: the agent there may ask it, on a message of yours', { verb: 'share', to: TESIS.chat }],
      [['share', 'reviewer', LAB.chat], 'agent reviewer · shared with Lab: the agent there may ask it, on a message of yours', { verb: 'share', to: LAB.chat }],
      [['unshare', 'reviewer', 'Tesis'], 'agent reviewer · no longer shared with Tesis: the agent there may not ask it', { verb: 'unshare', to: TESIS.chat }],
      [['unshare', 'reviewer', 'your 1:1'], 'agent reviewer · no longer shared with your 1:1: your agent there may not ask it', { verb: 'unshare', to: OWN.chat }],
      [['unshare', 'reviewer'], 'agent reviewer · not shared with your 1:1: nothing changed', null],
    ]
    for (const [args, said, posted] of steps) {
      const before = host.posts.length
      const r = await run(...args)
      assert.equal(r.code, 0, `${args.join(' ')}: ${r.err}`)
      assert.deepEqual(lines(r.out), [said], args.join(' '))
      assert.deepEqual(host.posts.slice(before), posted ? [{ verb: posted.verb, agent: REVIEWER.id, body: { to: posted.to } }] : [], args.join(' '))
    }
    assert.deepEqual(host.listed[0].exposures.map((x) => x.to), [LAB.chat])
    const listed = await cli(home, ['agents', '--host', host.url])
    assert.deepEqual(lines(listed.out), ['  reviewer   asked from Lab'])
  } finally { await host.close(); fs.rmSync(home, { recursive: true, force: true }) }
})

test('agent share refuses an agent you do not have, a chat the host does not offer, a name two chats share, and agent unshare a chat it is not asked from, before posting anything: exit 2', async () => {
  const twins = [{ id: 'chat:1c1c1c', name: 'a new group' }, { id: 'chat:2d2d2d', name: 'a new group' }]
  const host = await agentsHost({ agents: [agentOf(REVIEWER, { exposures: [{ to: LAB.chat, name: LAB.name }] })] }), home = homeAt(host.url)
  CHOICES.chats.push(...twins)
  try {
    const cases = [
      [['share', 'scout', 'Tesis'], /no agent of yours is named "scout" · atelier agents/],
      [['share', 'reviewer', 'Nowhere'], /no chat you may share reviewer with is named "Nowhere": a chat you are in with an agent of its own, or your 1:1 when none is named/],
      [['share', 'reviewer', 'a new group'], /2 chats are named "a new group": name one by its id: chat:1c1c1c, chat:2d2d2d/],
      [['unshare', 'reviewer', 'Tesis'], /reviewer is asked from no chat named "Tesis": atelier agents says where it is asked from/],
      [['share', 'reviewer', 'Tesis', 'Lab'], /one word too many: Lab/],
      [['share', 'reviewer', '--prompt', 'reviewer.md'], /unknown option: --prompt/],
      [['share'], /agent share <name>/],
    ]
    for (const [args, said] of cases) {
      const r = await cli(home, ['agent', ...args, '--host', host.url])
      assert.equal(r.code, 2, `${args.join(' ')}: ${r.err}`)
      assert.match(r.err, said)
    }
    assert.deepEqual(host.posts, [])
  } finally { CHOICES.chats.splice(-twins.length); await host.close(); fs.rmSync(home, { recursive: true, force: true }) }
})

test('agent share with no chat for an agent that lives on another computer asks for the chat, nothing posted, and a share the host refuses fails with its sentence and exit 4', async () => {
  const elsewhere = agentOf({ ...REVIEWER, computer: TESIS.computer, computerName: TESIS.label })
  const host = await agentsHost({ agents: [elsewhere], refuseShare: SHARE_REFUSED }), home = homeAt(host.url)
  try {
    const own = await cli(home, ['agent', 'share', 'reviewer', '--host', host.url])
    assert.equal(own.code, 2, own.err)
    assert.match(own.err, /reviewer lives on tesis, not your own computer: name the chat · atelier agent share reviewer <chat>/)
    assert.deepEqual(host.posts, [])
    const refused = await cli(home, ['agent', 'share', 'reviewer', 'Tesis', '--host', host.url])
    assert.equal(refused.code, 4, refused.err)
    assert.match(refused.err, new RegExp(`atelier agent share: ${SHARE_REFUSED}`))
    assert.deepEqual(lines(refused.out), [])
  } finally { await host.close(); fs.rmSync(home, { recursive: true, force: true }) }
})

test('agent rules <name> --prompt file replaces the prompt the host holds with the file as written and says its version, and that a folder of it here keeps the prompt it had', async () => {
  const host = await agentsHost({ agents: [agentOf(REVIEWER)] }), home = homeWithPrompt(host.url)
  const NEW = '# reviewer\n\nYou read pull requests, then say what breaks and why.\n'
  try {
    fs.writeFileSync(path.join(home, 'new.md'), NEW)
    const r = await cli(home, ['agent', 'rules', 'reviewer', '--prompt', 'new.md', '--host', host.url])
    assert.equal(r.code, 0, r.err)
    assert.deepEqual(host.posts, [{ verb: 'rules', agent: REVIEWER.id, body: { rules: NEW } }])
    assert.deepEqual(lines(r.out), ['agent reviewer · its prompt replaced · version 2'])
    fs.mkdirSync(path.join(home, 'reviewer'))
    fs.writeFileSync(path.join(home, 'reviewer', NAMING), JSON.stringify({ ...REVIEWER, host: host.url, made: '2026-11-10T10:00:00.000Z' }))
    const again = await cli(home, ['agent', 'rules', 'reviewer', '--prompt', 'new.md', '--host', host.url])
    assert.deepEqual(lines(again.out), ['agent reviewer · its prompt replaced · version 3 · the folder ./reviewer/ keeps the prompt it had'])
  } finally { await host.close(); fs.rmSync(home, { recursive: true, force: true }) }
})

test('agent rules without --prompt, with a file that cannot be read, or with a prompt the host refuses is written wrongly: exit 2, the host\'s sentence said', async () => {
  const host = await agentsHost({ agents: [agentOf(REVIEWER)] }), home = homeWithPrompt(host.url)
  try {
    fs.writeFileSync(path.join(home, 'blank.md'), '  \n')
    const cases = [
      [[], /agent rules replaces the prompt the host holds: --prompt <file>/, 0],
      [['--prompt', 'missing.md'], /cannot read missing\.md/, 0],
      [['--prompt', 'blank.md'], /the system prompt is your own words/, 1],
    ]
    for (const [more, said, posted] of cases) {
      const before = host.posts.length
      const r = await cli(home, ['agent', 'rules', 'reviewer', ...more, '--host', host.url])
      assert.equal(r.code, 2, r.err)
      assert.match(r.err, said)
      assert.equal(host.posts.length - before, posted)
    }
  } finally { await host.close(); fs.rmSync(home, { recursive: true, force: true }) }
})

test('agent rm deletes the agent at the host, which lists it no more, says nobody may ask it, and that a folder of it here stays as it was', async () => {
  const host = await agentsHost({ agents: [agentOf(REVIEWER, { exposures: [{ to: OWN.chat, name: OWN.name }] })] }), home = homeAt(host.url)
  try {
    fs.mkdirSync(path.join(home, 'reviewer'))
    fs.writeFileSync(path.join(home, 'reviewer', NAMING), JSON.stringify({ ...REVIEWER, host: host.url, made: '2026-11-10T10:00:00.000Z' }))
    const r = await cli(home, ['agent', 'rm', 'reviewer', '--host', host.url])
    assert.equal(r.code, 0, r.err)
    assert.deepEqual(host.posts, [{ verb: 'delete', agent: REVIEWER.id, body: {} }])
    assert.deepEqual(lines(r.out), ['agent reviewer · deleted: nobody may ask it, its prompt is gone · the folder ./reviewer/ stays on this machine'])
    assert.ok(fs.existsSync(path.join(home, 'reviewer', NAMING)))
    assert.deepEqual(lines((await cli(home, ['agents', '--host', host.url])).out), ['  no agents yet'])
    const gone = await cli(home, ['agent', 'rm', 'reviewer', '--host', host.url])
    assert.equal(gone.code, 2, gone.err)
    assert.match(gone.err, /no agent of yours is named "reviewer" · atelier agents/)
  } finally { await host.close(); fs.rmSync(home, { recursive: true, force: true }) }
})
