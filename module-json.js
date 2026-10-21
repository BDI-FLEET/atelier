// module.json — the declaration every app carries:
//
//   name           The name in the sidebar and the title, up to MODULE_NAME_CHARS characters.
//   icon           An icon name, or an emoji. Drawn by the frame, never imported by the app.
//   group, color   A heading the sidebar may group under; the app's accent.
//   primary        A request to land on this app when its place opens.
//   release        One shell command the host runs at a push, before the switch.
//   agent          {tools, teaching}: the calls the agent gets, and one page on when to use them. `tools` names them
//                  (lower case, digits, underscores); the backend's `tools(ctx)` export implements them; `teaching` is
//                  a file in the module's folder (AGENT.md). A local instance reads it and does nothing with it;
//                  module-serve.js serves the declared tools to the computer that runs the module.
//
// Unknown keys are ignored and reported. A missing file is the empty declaration: the module runs on its
// frontend's `meta` alone. A value of the wrong kind is reported and ignored, never half-applied.

import fs from 'node:fs';
import path from 'node:path';
import { MODULE_NAME_CHARS, TOOL_NAME_CHARS } from './limits.js';

export const MODULE_JSON = 'module.json';
/** A tool's name, as the agent sees it: lower case, digits and underscores, up to 64. */
export const TOOL_NAME = new RegExp(`^[a-z][a-z0-9_]{0,${TOOL_NAME_CHARS - 1}}$`);
/** The files a module folder runs from besides its module.json. */
export const BACKEND_FILE = 'backend.js';
export const FRONTEND_FILE = 'frontend.jsx';

const KINDS = {
  name: (v) => typeof v === 'string' && v.length > 0 && v.length <= MODULE_NAME_CHARS,
  icon: (v) => typeof v === 'string' && v.length > 0,
  group: (v) => typeof v === 'string',
  color: (v) => typeof v === 'string',
  primary: (v) => typeof v === 'boolean',
  release: (v) => typeof v === 'string' && v.trim().length > 0,
  agent: (v) => !!v && typeof v === 'object' && !Array.isArray(v)
    && (v.tools === undefined || (Array.isArray(v.tools) && v.tools.every((t) => typeof t === 'string' && TOOL_NAME.test(t))))
    && (v.teaching === undefined || typeof v.teaching === 'string'),
};
const SAYS = {
  name: `a text of 1 to ${MODULE_NAME_CHARS} characters`,
  icon: 'an icon name or an emoji',
  group: 'a text',
  color: 'a text',
  primary: 'true or false',
  release: 'one shell command',
  agent: '{ tools: ["a_tool", ...], teaching: "AGENT.md" }, each tool named in lower case, digits and underscores',
};

// The declaration of the module in `dir`: { declared, problems, mtimeMs }. `declared` holds only the keys above,
// each of the right kind; `problems` lists one line per unknown key or wrong value. No file → nothing declared.
export function readModuleJson(dir) {
  const file = path.join(dir, MODULE_JSON);
  let raw, mtimeMs;
  try { mtimeMs = fs.statSync(file).mtimeMs; raw = fs.readFileSync(file, 'utf8'); }
  catch { return { declared: {}, problems: [], mtimeMs: 0 }; }
  let obj;
  try { obj = JSON.parse(raw); }
  catch (e) { return { declared: {}, problems: [`not JSON (${e.message}); ignored`], mtimeMs }; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { declared: {}, problems: ['not an object; ignored'], mtimeMs };
  const declared = {};
  const problems = [];
  for (const [k, v] of Object.entries(obj)) {
    if (!(k in KINDS)) { problems.push(`unknown key "${k}", ignored`); continue; }
    if (!KINDS[k](v)) { problems.push(`"${k}" must be ${SAYS[k]}; ignored`); continue; }
    declared[k] = v;
  }
  return { declared, problems, mtimeMs };
}

// The part of the declaration the sidebar and the title read, in the shape a module's `meta` has.
export function sidebarFields(declared) {
  const out = {};
  for (const k of ['name', 'icon', 'group', 'color', 'primary']) if (declared[k] !== undefined) out[k] = declared[k];
  return out;
}

const reported = new Map();   // label → mtimeMs of the file whose problems were reported

// The declaration as the shell reads it beside the frontend's `meta`: { meta, mtimeMs }, `meta` its sidebar fields,
// which win over the frontend's where present (a module without a module.json keeps its `meta` as it is). Problems
// (an unknown key, a value of the wrong kind) are reported once per edit of the file, under `label`.
export function declaredMeta(dir, label) {
  const d = readModuleJson(dir);
  if (d.problems.length && reported.get(label) !== d.mtimeMs) {
    reported.set(label, d.mtimeMs);
    for (const p of d.problems) console.warn(`  ! ${label}/${MODULE_JSON}: ${p}`);
  }
  return { meta: sidebarFields(d.declared), mtimeMs: d.mtimeMs };
}
