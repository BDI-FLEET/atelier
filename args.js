/* atelier · a verb's arguments: its options declared as data, read by one loop, its help rendered from the same data.
 *
 * An option: { flag, also?, value?, help, check?, subs? }. `flag` is how it is written (`--host`, `-r`), `also` another
 * spelling (`--remote`); `value` the word its value is (`url`), none for a switch; `check(value)` answers true, or the
 * sentence that refuses it; `subs` the sub-verbs it belongs to (data's --yes: pull only). It is read under the name of
 * its long spelling: `--no-browser` → opts.noBrowser.
 */
import { DEFAULT_HOST } from './session.js';
import { HELP_COLUMN } from './limits.js';

export const HOST = {
  flag: '--host', value: 'url', help: `another host, for this call (default: ATELIER_HOST, else ${DEFAULT_HOST})`,
  check: (h) => /^https?:\/\//.test(h) || `"${h}" isn't a host url (http:// or https://)`,
};

export const REMOTE = { flag: '-r', also: '--remote', value: 'remote', help: 'the live app: a git remote of this module (atelier remote sets one)' };

const nameOf = (o) => [o.also, o.flag].find((f) => f?.startsWith('--'))?.slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase())
  ?? o.flag.replace(/^-+/, '');

/* The help: the usage lines, then one line per word (`words`: [name, help]) and per option, the helps in one column. */
export function helpOf({ usage, words = [], options = [] }) {
  const rows = [...words, ...options.map((o) => [`${o.flag}${o.value ? ` <${o.value}>` : ''}`, o.help])];
  const width = Math.max(HELP_COLUMN, ...rows.map(([l]) => l.length));
  const indent = '\n' + ' '.repeat(width + 4);
  return [`usage: ${usage}`, ...rows.map(([l, h]) => `  ${l.padEnd(width)}  ${h.split('\n').join(indent)}`)].join('\n');
}

/**
 * The verb's arguments, by `spec` = { usage, words, options, most, sub, rest }: at most `most` plain words (0 when not
 * said); with `rest`, what follows `--` is kept whole. -h or --help prints the help and exits 0; an unknown option, an
 * option without its value or a word too many fails (exit 2) with the help.
 * Answers { opts: { <name>: value | true }, words: [...], rest: [...] }.
 */
export function readArgs(argv, spec, fail) {
  const help = () => helpOf(spec);
  const opts = {}, words = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { console.log(help()); process.exit(0); }
    if (a === '--' && spec.rest) return { opts, words, rest: argv.slice(i + 1) };
    const o = (spec.options ?? []).find((x) => (x.flag === a || x.also === a) && (!x.subs || x.subs.includes(spec.sub)));
    if (o && !o.value) { opts[nameOf(o)] = true; continue; }
    if (o) {
      const v = argv[++i];
      if (v === undefined || v.startsWith('-')) fail(`${o.flag} needs <${o.value}>\n\n${help()}`);
      const verdict = o.check ? o.check(v) : true;
      if (verdict !== true) fail(`${verdict}\n\n${help()}`);
      opts[nameOf(o)] = v;
      continue;
    }
    if (a.startsWith('-')) fail(`unknown option: ${a}\n\n${help()}`);
    if (words.length >= (spec.most ?? 0)) fail(`one word too many: ${a}\n\n${help()}`);
    words.push(a);
  }
  return { opts, words, rest: [] };
}
