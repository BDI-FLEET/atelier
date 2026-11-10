// A fake host whose one op is an adopt on a computer's drive (artifacts-adopt, apps-adopt): it keeps the op asked and
// whatever goes into it, and its stream says the computer's lines and ends with the computer's code.
import { spawn } from 'node:child_process'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SECRET } from './files-host.js'

export { homeAt } from './files-host.js'

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'cli.js')
const OP = 'op-7a8b9c0d'

/* The host at `url`: the ops asked are kept in `asked`, what goes into them in `ins`; the stream says `said`, a line
 * each, and ends with `code`. */
export async function adoptHost(said, code) {
  const asked = [], ins = []
  const server = http.createServer(async (req, res) => {
    const chunks = []
    for await (const c of req) chunks.push(c)
    const raw = Buffer.concat(chunks).toString('utf8')
    const body = raw ? JSON.parse(raw) : {}
    const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }
    if (req.headers.authorization !== `Session ${SECRET}`) return send(401, { refused: 'the session is not valid; sign in again' })
    if (req.method === 'POST' && req.url === '/api/ops') { asked.push(body); return send(201, { op: OP, computer: body.computer }) }
    if (req.method === 'GET' && req.url === `/api/ops/${OP}/stream`) {
      res.writeHead(200, { 'content-type': 'application/x-ndjson' })
      for (const f of [{ started: true }, ...said.map((line) => ({ line })), { done: true, code }]) res.write(JSON.stringify(f) + '\n')
      return res.end()
    }
    if (req.method === 'POST' && req.url === `/api/ops/${OP}/in`) { ins.push(body); return send(200, { ok: true }) }
    send(404, { error: 'no such route' })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  return { url: `http://127.0.0.1:${server.address().port}`, asked, ins, close: () => new Promise((r) => { server.closeAllConnections(); server.close(r) }) }
}

/* atelier <args> from `home` (or `cwd`), with no host, socket or sandbox named in its environment but what `env` names:
 * its code, stdout and stderr. */
export function cli(home, args, { cwd = home, env: more = {} } = {}) {
  const env = { ...process.env, HOME: home }
  for (const k of ['ATELIER_HOST', 'XDG_CONFIG_HOME', 'ATELIER_SOCKET', 'ATELIER_SANDBOX']) delete env[k]
  Object.assign(env, more)
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [CLI, ...args], { cwd, env })
    let out = '', err = ''
    c.stdout.on('data', (d) => { out += d })
    c.stderr.on('data', (d) => { err += d })
    c.on('close', (code) => resolve({ code, out, err }))
  })
}
