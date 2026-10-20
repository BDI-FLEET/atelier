/* atelier add · atelier update for a module that is a git repository: add
 * clones a module's repository into the instance folder; update pulls it, and
 * without a name pulls every module that has a remote.
 *
 *   atelier add <git-url>       a clone at <instance>/<repository's name>
 *   atelier update [module]     git pull --ff-only in that clone (every clone with a remote when none is named)
 *
 *   added notes · cloned from https://example.org/notes.git at 9c04e1f
 *   notes · 9c04e1f → 3f9c2ab
 *
 * A repository with a module.json at its top is a module. Anything else given
 * to add (a collection: top-level folders that are modules) goes on to the
 * collection form in add.js; update with a collection's name, the same.
 * Local edits in a module are never touched by update: a pull that is not a
 * fast-forward says so and changes nothing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const git = (args, cwd) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  return { code: r.status ?? 1, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
};
const NAME = /^[a-zA-Z0-9][\w.-]*$/;

/* Clone `url` into the instance when it is a module's repository: { code } done (0 or 1), or null: not a module, the collection form goes on. */
export function addModule(root, url) {
  const tmp = path.join(root, `.atelier-add-${randomBytes(3).toString('hex')}`);
  const c = git(['clone', '-q', url, tmp], root);
  if (c.code !== 0) { fs.rmSync(tmp, { recursive: true, force: true }); return null; }   // the collection form says why
  if (!fs.existsSync(path.join(tmp, 'module.json'))) { fs.rmSync(tmp, { recursive: true, force: true }); return null; }
  const name = path.basename(url.replace(/[/\\]+$/, '')).replace(/\.git$/, '').replace(/\.bundle$/, '');
  if (!NAME.test(name)) { fs.rmSync(tmp, { recursive: true, force: true }); console.error(`\natelier add: "${name}" is not a folder name for a module\n`); return { code: 2 }; }
  const dest = path.join(root, name);
  if (fs.existsSync(dest)) { fs.rmSync(tmp, { recursive: true, force: true }); console.error(`\natelier add: a folder ${name} is here already · atelier update ${name} pulls it\n`); return { code: 1 }; }
  fs.renameSync(tmp, dest);
  console.log(`  added ${name} · cloned from ${url} at ${git(['rev-parse', '--short', 'HEAD'], dest).out || 'no commit yet'}`);
  return { code: 0 };
}

/* The module folders of the instance that are git repositories with a remote, by name. */
function clones(root) {
  let es = [];
  try { es = fs.readdirSync(root, { withFileTypes: true }); } catch { return []; }
  return es.filter((e) => e.isDirectory() && NAME.test(e.name) && fs.existsSync(path.join(root, e.name, '.git')) && fs.existsSync(path.join(root, e.name, 'module.json'))
    && git(['remote'], path.join(root, e.name)).out !== '').map((e) => e.name).sort();
}

/* Pull one clone, or every one: { code, pulled } when it was this form; null when `name` is no clone here (a collection's name). */
export function updateModules(root, name) {
  const all = clones(root);
  if (name && !all.includes(name)) return null;
  let code = 0;
  for (const n of name ? [name] : all) {
    const dir = path.join(root, n), was = git(['rev-parse', '--short', 'HEAD'], dir).out;
    const p = git(['pull', '--ff-only', '--quiet'], dir);
    const now = git(['rev-parse', '--short', 'HEAD'], dir).out;
    if (p.code !== 0) { console.error(`  ${n} · not pulled: ${(p.err.split('\n').find((l) => l.trim()) || 'git pull failed').trim()}`); code = 1; }
    else console.log(`  ${n} · ${was === now ? `${now}, up to date` : `${was} → ${now}`}`);
  }
  return { code, pulled: name ? 1 : all.length };
}
