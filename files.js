#!/usr/bin/env node
/* atelier files push · pull · sync — a one-off copy between a local folder and
 * a computer's drive. Only what differs moves, and an interrupted copy picks up
 * where it stopped. The drive side is written computer:/path, where the path is
 * inside the computer's files/.
 *
 *   atelier files push <folder> <computer>:/<path>
 *   atelier files pull <computer>:/<path> <folder>
 *   atelier files sync <folder> <computer>:/<path> --up | --down | --both
 *
 *   comparing … 412 files, 1.8 GB to send
 *   done · 412 files · 6 min 12 s
 *
 * Through the host with your session (ops.js): push needs files write on that
 * computer, pull files read.
 * push: every file hashed here (sha256), the list sent, the computer answers
 * which contents it lacks and how much of each it holds already from an earlier
 * try; those go in 256 KB pieces named by their hash, then each is put in
 * place. pull: the computer's list, every file that differs here comes down in
 * pieces into `<file>.atelier-part`, kept across an interruption and checked by
 * its hash before it takes the file's place.
 * sync --up is a push, --down a pull. --both: a file on one side only goes to
 * the other; a file changed on both sides: the newer one wins and the other is
 * kept beside it, named with who wrote it and when, "notes (k1, 7 Oct 08:31).md",
 * on both sides. Nothing is deleted on either side (there is no --delete), so a
 * sync never removes a file. There is no --watch: run sync from a timer.
 * Inside a sandbox the drive is its files/: this verb is a machine's.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { failer, runOp, exitOf, inSandbox, PIECE, sizeWords } from './ops.js';
import { resolveHost } from './session.js';
import { readArgs, helpOf, HOST } from './args.js';

const SUBS = ['push', 'pull', 'sync'];
const WAYS = ['up', 'down', 'both'];
const SPEC = {
  usage: 'atelier files push <folder> <computer>:/<path>\n       atelier files pull <computer>:/<path> <folder>\n'
    + '       atelier files sync <folder> <computer>:/<path> --up | --down | --both',
  words: [['<computer>', 'one of atelier computers; <path> inside its files/']],
  options: [
    { flag: '--up', subs: ['sync'], help: 'a push' }, { flag: '--down', subs: ['sync'], help: 'a pull' },
    { flag: '--both', subs: ['sync'], help: 'each side gets what it lacks; a file changed on both: the newer wins, the other kept beside it' },
    HOST,
  ],
  most: 2,
};
const USAGE = helpOf(SPEC);
const fail = failer('files');
const argv = process.argv.slice(2);
const sub = SUBS.includes(argv[0]) ? argv.shift() : null;
const { opts, words } = readArgs(argv, { ...SPEC, sub }, fail);
if (!sub) fail(`files ${argv[0] ?? 'what'}? push, pull or sync\n\n${USAGE}`);
const host = resolveHost(opts.host);
if (inSandbox()) fail('inside a sandbox the drive is its files/: files push and pull are a machine\'s', 1);
const dir = sub === 'pull' ? 0 : 1;   // which word is the drive's
const ways = WAYS.filter((w) => opts[w]);
if (ways.length > 1) fail(`one direction\n\n${USAGE}`);
const way = ways[0] ?? null;
if (words.length !== 2) fail(`${sub} takes ${sub === 'pull' ? '<computer>:/<path> <folder>' : '<folder> <computer>:/<path>'}\n\n${USAGE}`);
if (sub === 'sync' && !way) fail(`say the direction: --up, --down or --both\n\n${USAGE}`);
const drive = /^([A-Za-z0-9_.-]+):(\/.*)?$/.exec(words[dir]);
if (!drive) fail(`"${words[dir]}" is not computer:/path\n\n${USAGE}`);
const computer = drive[1], remotePath = (drive[2] || '/').replace(/^\/+/, '');
if (remotePath.split('/').includes('..')) fail('the path stays inside the drive');
const folder = path.resolve(words[1 - dir]);
const t0 = Date.now();

const took = () => { const s = Math.round((Date.now() - t0) / 1000); return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`; };
const shaOf = (f) => new Promise((ok, no) => { const h = crypto.createHash('sha256'); fs.createReadStream(f).on('data', (d) => h.update(d)).on('error', no).on('end', () => ok(h.digest('hex'))); });
const when = (ms) => { const d = new Date(ms); return `${d.getDate()} ${d.toLocaleString('en', { month: 'short' })} ${String(d.getHours()).padStart(2, '0')}.${String(d.getMinutes()).padStart(2, '0')}`; };
const beside = (p, who, ms) => { const ext = path.extname(p); return `${p.slice(0, p.length - ext.length)} (${who}, ${when(ms)})${ext}`; };

/* The local folder's files: path (with /), size, mtime, sha256; never a part file of ours. */
async function localFiles(root) {
  const out = [];
  const go = (d) => {
    let es = [];
    try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es.sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) go(p);
      else if (e.isFile() && !e.name.endsWith('.atelier-part')) { const st = fs.statSync(p); out.push({ path: path.relative(root, p).split(path.sep).join('/'), size: st.size, mtime: st.mtimeMs, abs: p }); }
    }
  };
  go(root);
  for (const f of out) f.sha256 = await shaOf(f.abs);
  return out;
}

/* One push op: these local files to the drive's folder; only the contents it lacks travel. */
async function push(list, label = 'files') {
  const total = list.reduce((n, f) => n + f.size, 0);
  let sent = 0;
  const code = await runOp('files', { host, computer }, { verb: 'files-push', path: remotePath }, {
    during: async (into) => {
      const need = new Map();
      for (let i = 0; i < list.length; i += 500) {
        const a = await into({ have: list.slice(i, i + 500).map(({ path, size, sha256 }) => ({ path, size, sha256 })) });
        if (!Array.isArray(a.need)) throw new Error(a.refused || 'the computer did not say what it lacks');
        for (const n of a.need) need.set(n.sha256, n.from);
      }
      const todo = [...need].map(([sha, from]) => ({ sha, from, f: list.find((x) => x.sha256 === sha) }));
      const toSend = todo.reduce((n, x) => n + x.f.size - Math.min(x.from, x.f.size), 0);
      console.error(`comparing … ${list.length} ${list.length === 1 ? label.replace(/s$/, '') : label}, ${sizeWords(toSend)} to send`);
      for (const x of todo) {
        const fd = fs.openSync(x.f.abs, 'r');
        try {
          for (let at = Math.min(x.from, x.f.size); at < x.f.size;) {
            const buf = Buffer.alloc(Math.min(PIECE, x.f.size - at));
            fs.readSync(fd, buf, 0, buf.length, at);
            const p = await into({ put: x.sha, at, data: buf.toString('base64') });
            if (!Number.isInteger(p.at)) throw new Error(p.refused || 'the computer took no bytes');
            sent += Math.max(0, p.at - at);
            at = p.at;
          }
        } finally { fs.closeSync(fd); }
      }
      const placing = list.filter((f) => need.has(f.sha256));
      for (let i = 0; i < placing.length; i += 500) {
        const p = await into({ place: placing.slice(i, i + 500).map(({ path, size, sha256 }) => ({ path, size, sha256 })) });
        if (Array.isArray(p.missing) && p.missing.length) throw new Error(`not placed: ${p.missing.slice(0, 3).join(', ')}`);
      }
      await into({ end: true });
    },
    onFrame: (f) => { if (typeof f.line === 'string' && !/^done · /.test(f.line)) process.stderr.write(`remote: ${f.line}\n`); },
  });
  return { code, total, sent };
}

/* The drive's folder as the computer lists it: path, size, mtime, sha256. */
async function remoteList(into) {
  const out = [];
  for (let after = 0; ;) {
    const p = await into({ list: true, after });
    if (!Array.isArray(p.files)) throw new Error(p.refused || 'the computer sent no list');
    out.push(...p.files);
    if (!p.more) return out;
    after += p.files.length;
  }
}

/* One file down, into <file>.atelier-part (kept across an interruption), checked, then in place. */
async function fetchFile(into, f, dest) {
  const part = `${dest}.atelier-part`;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  let at = fs.existsSync(part) ? fs.statSync(part).size : 0;
  if (at > f.size) { fs.rmSync(part); at = 0; }
  for (let tries = 0; tries < 2; tries++) {
    while (at < f.size) {
      const p = await into({ get: f.path, at });
      if (typeof p.data !== 'string') throw new Error(p.refused || `${f.path} did not come`);
      const b = Buffer.from(p.data, 'base64');
      if (!b.length) throw new Error(`${f.path} came short`);
      fs.appendFileSync(part, b);
      at += b.length;
    }
    if (!fs.existsSync(part)) fs.writeFileSync(part, '');
    if (await shaOf(part) === f.sha256) { fs.renameSync(part, dest); if (f.mtime) fs.utimesSync(dest, new Date(), new Date(f.mtime)); return f.size; }
    fs.rmSync(part, { force: true }); at = 0;   // an old part of another version: once more from the start
  }
  throw new Error(`${f.path} came down broken twice`);
}

/* One pull op: the drive's folder into the local one; only what differs comes. `pick` chooses; `place` names the local path. */
async function pull({ pick = () => true, place = (f) => path.join(folder, f.path), quiet = false } = {}) {
  let got = 0, files = 0, listed = 0;
  const code = await runOp('files', { host, computer }, { verb: 'files-pull', path: remotePath }, {
    during: async (into) => {
      const list = await remoteList(into);
      listed = list.length;
      const todo = [];
      for (const f of list) {
        if (!pick(f)) continue;
        const dest = place(f);
        let same = false;
        try { const st = fs.statSync(dest); same = st.isFile() && st.size === f.size && await shaOf(dest) === f.sha256; } catch { /* not here */ }
        if (!same) todo.push({ f, dest });
      }
      if (!quiet) console.error(`comparing … ${list.length} file${list.length === 1 ? '' : 's'}, ${sizeWords(todo.reduce((n, x) => n + x.f.size, 0))} to fetch`);
      for (const x of todo) { got += await fetchFile(into, x.f, x.dest); files++; }
      await into({ end: true });
    },
    onFrame: (f) => { if (typeof f.line === 'string' && !/^done · /.test(f.line)) process.stderr.write(`remote: ${f.line}\n`); },
  });
  return { code, got, files, listed };
}

if (sub === 'push' || (sub === 'sync' && way === 'up')) {
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) fail(`${words[0]} is not a folder`);
  const list = await localFiles(folder);
  const r = await push(list);
  if (r.code !== 0) process.exit(exitOf(r.code));
  console.log(`done · ${list.length} file${list.length === 1 ? '' : 's'} · ${took()}`);
  process.exit(0);
}
if (sub === 'pull' || (sub === 'sync' && way === 'down')) {
  fs.mkdirSync(folder, { recursive: true });
  const r = await pull();
  if (r.code !== 0) process.exit(exitOf(r.code));
  console.log(`done · ${r.listed} file${r.listed === 1 ? '' : 's'} · ${r.files} fetched · ${took()}`);
  process.exit(0);
}

// --both: the newer side wins; the other kept beside it on both sides
fs.mkdirSync(folder, { recursive: true });
const mine = await localFiles(folder);
const me = process.env.USER || 'this machine';
let theirs = [];
{
  // the drive's list, and every file it has that is new here or newer there comes down (a loser here is renamed first)
  const r = await pull({ quiet: true, pick: (f) => {
    theirs.push(f);
    const l = mine.find((x) => x.path === f.path);
    if (!l) return true;
    if (l.sha256 === f.sha256 || l.mtime >= f.mtime) return false;
    const kept = beside(l.abs, me, l.mtime);
    fs.renameSync(l.abs, kept);   // the loser, kept beside it here; it goes up below
    return true;
  }, place: (f) => path.join(folder, f.path) });
  if (r.code !== 0) process.exit(exitOf(r.code));
  // a file newer here that differs there: the drive's version comes down beside it first, so both sides keep both
  const older = theirs.filter((f) => { const l = mine.find((x) => x.path === f.path); return l && l.sha256 !== f.sha256 && l.mtime >= f.mtime; });
  if (older.length) {
    const r2 = await pull({ quiet: true, pick: (f) => older.some((o) => o.path === f.path), place: (f) => beside(path.join(folder, f.path), computer, f.mtime) });
    if (r2.code !== 0) process.exit(exitOf(r2.code));
  }
}
// everything here the drive does not hold as it is here now goes up (new files, the winners, the kept losers)
const now = await localFiles(folder);
const up = now.filter((l) => !theirs.some((f) => f.path === l.path && f.sha256 === l.sha256));
const r = up.length ? await push(up) : { code: 0 };
if (r.code !== 0) process.exit(exitOf(r.code));
console.log(`in step · ${now.length} file${now.length === 1 ? '' : 's'} · ${took()}`);
process.exit(0);
