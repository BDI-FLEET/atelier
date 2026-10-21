// The files of the hosted CLI, the backend processes and module-serve, by name, for the measures that read them.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const FILES = [
  'agent-attach.js', 'agent.js', 'args.js', 'attach-client.js', 'attach.js', 'backend-host.js', 'clone.js',
  'computers.js', 'config.js', 'create.js', 'data.js', 'files.js', 'frame.jsx', 'frames.js', 'hosted.js',
  'login-screen.js', 'login.js', 'logout.js', 'logs.js', 'module-json.js', 'module-serve.js', 'modules-git.js',
  'ops.js', 'ps.js', 'push.js', 'releases.js', 'remote.js', 'repo.js', 'restart.js', 'router.js', 'run.js',
  'sandbox.js', 'session.js', 'whoami.js', 'ws-bridge.js',
]

export const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8')

/* A file's lines of code, numbered from 1: comment lines left out. */
export const codeLines = (f) => read(f).split('\n').map((line, i) => ({ line, at: i + 1 })).filter(({ line }) => !/^\s*(?:\/\/|\/\*|\*)/.test(line))
