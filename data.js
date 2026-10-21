#!/usr/bin/env node
/* atelier data pull · atelier data push — an app's data/ has exactly one
 * writer, the running app; these two verbs are the deliberate exceptions, and
 * both are single acts.
 *
 *   atelier data pull [-r remote] [--yes]
 *   atelier data push [-r remote] [--confirm <app>]
 *
 * pull copies a consistent snapshot of the live data into the module's local
 * data/, to reproduce a bug on real data; it asks before replacing local data
 * that exists. The computer stops the app while it takes data/ as one tar,
 * starts it again, and the tar comes down in pieces; here it replaces this
 * folder's data/ (asked first, or --yes).
 * push seeds a live app with what was built up locally: it shows what it will
 * replace, makes you type the app's name, backs up the live data, replaces
 * it, restarts the app, and records the act. --confirm <app> types
 * the name for a script or an agent.
 *
 *   This replaces the live data of notes in computer k1.
 *     yours:  48 MB
 *   Type the app's name to continue: notes
 *   remote: live data backed up (12 kB) · data replaced (48 MB) · notes restarted
 *
 * Both through the host on your maintain grant (ops.js), both recorded.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { spawnSync } from 'node:child_process';
import { failer, whereOf, runOp, exitOf, sizeWords, shaOf, putPieces } from './ops.js';
import { readArgs, helpOf, REMOTE } from './args.js';

const SUBS = ['pull', 'push'];
const SNAPSHOT = 'data.tar';
const SPEC = {
  usage: 'atelier data pull [-r remote] [--yes]\n       atelier data push [-r remote] [--confirm <app>]',
  options: [REMOTE, { flag: '--yes', subs: ['pull'], help: "replace this folder's data/ without asking" },
    { flag: '--confirm', value: 'app', subs: ['push'], help: "the app's name, typed for a script or an agent" }],
};
const fail = failer('data');
const argv = process.argv.slice(2);
const sub = SUBS.includes(argv[0]) ? argv.shift() : null;
const which = () => fail(`data ${argv[0] ?? 'what'}? pull or push\n\n${helpOf(SPEC)}`);
if (!sub && argv[0] && !argv[0].startsWith('-')) which();
const { opts: { remote = null, yes = false, confirm: given = null } } = readArgs(argv, { ...SPEC, sub }, fail);
if (!sub) which();
let confirm = given;
const where = whereOf(remote, fail, `data ${sub}`);
const local = path.join(where.dir, 'data');
const size = (d) => { let n = 0; const go = (p) => { for (const e of fs.readdirSync(p, { withFileTypes: true })) { const q = path.join(p, e.name); if (e.isDirectory()) go(q); else if (e.isFile()) n += fs.statSync(q).size; } }; try { go(d); } catch {} return n; };
const ask = async (q) => { const rl = readline.createInterface({ input: process.stdin, output: process.stderr }); try { return (await rl.question(q)).trim(); } finally { rl.close(); } };

if (sub === 'pull') {
  if (fs.existsSync(local) && size(local) > 0 && !yes) {
    if (!process.stdin.isTTY) fail(`this folder has a data/ (${sizeWords(size(local))}): --yes replaces it`, 2);
    if (!/^y(es)?$/i.test(await ask(`This replaces your local data/ (${sizeWords(size(local))}) with the live one. Continue? [y/N] `))) fail('nothing changed', 1);
  }
  const work = fs.mkdtempSync(path.join(where.dir, '.atelier-data-'));
  process.on('exit', () => fs.rmSync(work, { recursive: true, force: true }));
  const tar = path.join(work, SNAPSHOT);
  {
    const code = await runOp('data', where, { verb: 'data-pull' }, {
      // the snapshot in pieces: { get, at } until it is all here, checked by its sha256
      during: async (into) => {
        const fd = fs.openSync(tar, 'w', 0o600);
        let at = 0, total = null, sha = null;
        try {
          while (total === null || at < total) {
            const p = await into({ get: 'data', at });
            if (typeof p.data !== 'string') throw new Error(p.refused || 'the computer sent no bytes');
            if (p.sha256) sha = p.sha256;
            total = p.size;
            const b = Buffer.from(p.data, 'base64');
            fs.writeSync(fd, b, 0, b.length, at);
            at += b.length;
            if (!b.length && at < total) throw new Error('the computer sent an empty piece');
          }
        } finally { fs.closeSync(fd); }
        if (sha && await shaOf(tar) !== sha) throw new Error('the snapshot came down broken');
        await into({ end: true });
      },
      socket: { into: path.relative(process.cwd(), tar) },
    });
    if (code !== 0) process.exit(exitOf(code));
    // the live data/ in place of this folder's
    const x = spawnSync('tar', ['-xf', tar, '-C', work], { encoding: 'utf8' });
    if (x.status !== 0 || !fs.existsSync(path.join(work, 'data'))) fail(`the snapshot could not be opened: ${(x.stderr || '').trim()}`, 1);
    fs.rmSync(local, { recursive: true, force: true });
    fs.renameSync(path.join(work, 'data'), local);
    console.log(`data/ is the live one now · ${sizeWords(size(local))}`);
  }
  process.exit(0);
}

// push: what will be replaced, the app's name typed, then the tar in pieces
if (!fs.existsSync(local) || !fs.statSync(local).isDirectory()) fail('this folder has no data/ to push', 2);
console.error(`\nThis replaces the live data of ${where.module} in computer ${where.computer}.\n  yours:  ${sizeWords(size(local))}`);
if (confirm === null) {
  if (!process.stdin.isTTY) fail(`type the app's name to continue: --confirm ${where.module}`, 2);
  confirm = await ask(`Type the app's name to continue: `);
}
if (confirm !== where.module) fail(`"${confirm}" is not ${where.module}; nothing changed`, 1);
const work = fs.mkdtempSync(path.join(where.dir, '.atelier-data-'));
process.on('exit', () => fs.rmSync(work, { recursive: true, force: true }));
const tar = path.join(work, SNAPSHOT);
{
  const t = spawnSync('tar', ['-cf', tar, '-C', where.dir, 'data'], { encoding: 'utf8' });
  if (t.status !== 0) fail(`data/ could not be packed: ${(t.stderr || '').trim()}`, 1);
  const size = fs.statSync(tar).size;
  const code = await runOp('data', where, { verb: 'data-push', confirm }, {
    during: async (into) => {
      await putPieces(into, 'data', tar, { size });
      const e = await into({ end: true, size, sha256: await shaOf(tar) });
      if (!e.ok) throw new Error(e.refused || 'the computer did not take the data');
    },
    socket: { from: path.relative(process.cwd(), tar) },
  });
  process.exit(exitOf(code));
}
