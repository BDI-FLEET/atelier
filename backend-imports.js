// The relative imports of a module's backend that Node does not find as they are written: a name without its extension
// (`./db` for db.js) or a folder (`./lib` for lib/index.js). A bundler found them; Node imports the backend as it is and
// ends at the first one. Read from backend.js and the files it imports by a relative path, transitively, by their
// static import and export lines, without running any of them. An import is named only when the file it means is
// there, so the sentence can say what to write; a `require` (createRequire finds `./db`) is never one.
import fs from 'node:fs';
import path from 'node:path';
import { BACKEND_FILE } from './module-json.js';

const STATIC_IMPORT = /^[ \t]*(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"](\.\.?\/[^'"]+)['"]/gm;
/** What Node would need written after an import's name to find the file the old host's bundler found. */
const ANSWERS = ['.js', '.mjs', '/index.js', '/index.mjs'];
const isFile = (f) => { try { return fs.statSync(f).isFile(); } catch { return false; } };
const posix = (p) => p.split(path.sep).join('/');

/** Each import of the backend in `dir` Node does not find as written: { file, line, spec, fix }, `file` under `dir`, `fix` the specifier to write. */
export function unfoundImports(dir) {
  const found = [], seen = new Set();
  const ours = (f) => { const rel = path.relative(dir, f); return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel) && !rel.split(path.sep).includes('node_modules'); };
  const visit = (abs) => {
    if (seen.has(abs)) return;
    seen.add(abs);
    let src;
    try { src = fs.readFileSync(abs, 'utf8'); } catch { return; }
    for (const m of src.matchAll(STATIC_IMPORT)) {
      const spec = m[1], target = path.resolve(path.dirname(abs), spec);
      if (!ours(target)) continue;
      if (isFile(target)) { if (/\.m?js$/.test(target)) visit(target); continue; }
      const answer = ANSWERS.map((tail) => target + tail).find(isFile);
      if (!answer) continue;
      const fix = posix(path.relative(path.dirname(abs), answer));
      found.push({ file: posix(path.relative(dir, abs)), line: src.slice(0, m.index).split('\n').length, spec, fix: fix.startsWith('.') ? fix : `./${fix}` });
      visit(answer);
    }
  };
  const entry = path.join(dir, BACKEND_FILE);
  if (isFile(entry)) visit(entry);
  return found;
}

/** The sentence said for one of them, the fix in it. */
export const unfoundSaid = ({ file, line, spec, fix }) => `${file}:${line} imports '${spec}', which Node does not find as written: write '${fix}'`;
