/* The screen `atelier login` draws while it waits for the person to approve
 * this machine in the browser: a title, a small night scene with a bay horse
 * drawn in block characters, one sentence of what happens, the link
 * with the code in it, and the code alone.
 *
 * Pure functions, so a test can draw the screen without a terminal:
 *   screen({ version, host, link, code, opened, canCopy, art })  the text up to "waiting …"
 *   drawScene(depth)                                              the scene, as lines with ANSI colours
 *   openBrowser(url) / copyText(text)                             best effort; never throw
 */
import { spawn, spawnSync } from 'node:child_process';
import { OPENER_MS } from './limits.js';

/* The scene, one letter per pixel. Two pixel rows share one terminal row
 * (the upper half block ▀ in the top pixel's colour on the bottom pixel's
 * colour), so these 28 rows draw as 14 lines. Letters:
 *   .  sky (the terminal's own background)     *  a star
 *   a  the horse's coat, chestnut brown        d  the coat in shade (far legs, belly)
 *   k  black points: mane, tail, lower legs    g  the gold of the bridle
 *   c  cloud                                   C  the cloud's lit top
 *   m  the moon
 * The horse faces left. */
export const SCENE = [
  '.......................k.k..................................',
  '......................kakk............................mmm...',
  '...*...............aaaagakk...........*..............mmm....',
  '.................aaakgaaaakk........................mmm.....',
  '...............aaaaaagaaaaakk.......................mmm.....',
  '..............aaaaaaagaaaaaakk......................mmm.....',
  '.........*...aaaaaaagaaaaaaaakk..............*.......mmm....',
  '.............kaaaagggaaaaaaaaakk......................mmm...',
  '..............dddd...aaaaaaaaaakk...........................',
  '.....................aaaaaaaaaaakk..........................',
  '....................aaaaaaaaaaaaakk.......................*.',
  '....................aaaaaaaaaaaaaakkk.......................',
  '...CCCC.............aaaaaaaaaaaaaaaaaaaaaaaakk..............',
  '.CCCCCCCC...........aaaaaaaaaaaaaaaaaaaaaaaaakk.............',
  'CCcccccccCC..........aaaaaaaaaaaaaaaaaaaaaaaa.kk............',
  'ccccccccccccc........daaaaaaaaaaaaaaaaaaaaaaa.kk............',
  '.cccccccccc...........aaaaaaaaaaaaaaaaaaaaaaa.kk............',
  '......................daaaaaaaaaaaaaaaaaaaaad.kk............',
  '.......................daaaaaaaaaaaaaaaaaaad..kk.....CCC....',
  '........................aa..dd.....dd.aaaaa..kk...CCCCCCCC..',
  '........................aa..dd.....dd..aaa...kk..CCcccccccC.',
  '........................aa..dd.....dd...aa...k..cccccccccccc',
  '........................aa..dd.....dd...aa...k....cccccccc..',
  '........................ka..dk.....dk...ka..................',
  '..*.....................kk..kk.....kk...kk..................',
  '........................kk..kk.....kk...kk..................',
  '........................kk..kk.....kk...kk..*...............',
  '.......................kkk.kkk....kkk..kkk..................',
];
export const SCENE_WIDTH = SCENE[0].length;

// Each colour twice: 24-bit, and the hand-picked nearest of the 256 colours for terminals without 24-bit colour
// (Apple's Terminal among them); a computed nearest turned the chestnut coat olive.
const PALETTE = {
  a: [[154, 74, 28], 130], d: [[107, 50, 18], 94], k: [[52, 42, 40], 236], g: [[212, 160, 23], 178],
  c: [[58, 62, 74], 237], C: [[82, 87, 102], 240], m: [[240, 230, 180], 229], '*': [[230, 220, 160], 187],
};
const GOLD = PALETTE.g;

/** 24-bit when the terminal says so (COLORTERM), else the 256 colours every terminal of today draws. */
export const colourDepth = (env = process.env) => (/^(truecolor|24bit)$/i.test(env.COLORTERM || '') ? 24 : 8);
const fg = ([rgb, x256], depth) => (depth === 24 ? `\x1b[38;2;${rgb.join(';')}m` : `\x1b[38;5;${x256}m`);
const bg = ([rgb, x256], depth) => (depth === 24 ? `\x1b[48;2;${rgb.join(';')}m` : `\x1b[48;5;${x256}m`);
const RESET = '\x1b[0m';

/** The scene as terminal lines: two pixel rows per line, the sky left as the terminal's own background. */
export function drawScene(depth = 8) {
  const lines = [];
  for (let y = 0; y < SCENE.length; y += 2) {
    let line = '';
    for (let x = 0; x < SCENE_WIDTH; x++) {
      const t = SCENE[y][x], b = SCENE[y + 1]?.[x] ?? '.';
      const top = t !== '.' && t !== '*' ? PALETTE[t] : null, bot = b !== '.' && b !== '*' ? PALETTE[b] : null;
      if (!top && !bot) line += t === '*' || b === '*' ? `${fg(PALETTE['*'], depth)}*${RESET}` : ' ';
      else if (top && !bot) line += `${fg(top, depth)}▀${RESET}`;
      else if (!top && bot) line += `${fg(bot, depth)}▄${RESET}`;
      else if (t === b) line += `${fg(top, depth)}█${RESET}`;
      else line += `${fg(top, depth)}${bg(bot, depth)}▀${RESET}`;
    }
    lines.push(line);
  }
  return lines;
}

/**
 * The screen up to "waiting …", as one string. `art` false (--plain, or stdout not a terminal): the same words, no
 * colour, no scene, no rule, so a log or an agent reading the output gets only the text. `opened` says whether a
 * browser was started; `canCopy` whether the c key works here (a terminal on stdin).
 */
export function screen({ version, host, link, code, opened, canCopy, art, depth = 8 }) {
  const out = [];
  const rule = '·'.repeat(SCENE_WIDTH);
  const dim = (s) => (art ? `\x1b[2m${s}${RESET}` : s);
  const title = `Welcome to the atelier · ${version}`;
  out.push(art ? `${fg(GOLD, depth)}\x1b[1m${title}${RESET}` : title);
  if (art) out.push('', dim(rule), ...drawScene(depth), dim(rule));
  out.push('');
  out.push(opened
    ? `This signs this terminal in to your atelier at ${host}: approve it in the browser that just opened.`
    : `This signs this terminal in to your atelier at ${host}: open the link below in a browser where you are signed in, and approve it.`);
  out.push('');
  out.push(opened ? `Browser didn't open? Use the link below${canCopy ? ' (c to copy)' : ''}` : `The link${canCopy ? ' (c to copy)' : ''}`);
  out.push(art ? `\x1b[4m${link}${RESET}` : link);
  // the code alone, for typing it on another machine's /activate page
  out.push(art ? `Code ${'\x1b[1m'}${code}${RESET}` : `Code ${code}`);
  // No "paste the code here" line: in this flow nothing comes back to the terminal by hand; the host tells the waiting
  // CLI once the person approved (GET /api/activate/<handle>).
  return out.join('\n') + '\n';
}

/**
 * Open the link in the person's browser, best effort: $BROWSER when set (the old Unix convention, and how a test
 * watches the call), else the platform's opener. Answers whether one was started; never throws, never waits.
 */
export function openBrowser(url, { env = process.env, platform = process.platform } = {}) {
  const [cmd, args] = env.BROWSER ? [env.BROWSER, [url]]
    : platform === 'darwin' ? ['open', [url]]
    : platform === 'win32' ? ['cmd', ['/c', 'start', '""', url.replace(/&/g, '^&')]]
    : ['xdg-open', [url]];
  try {
    const p = spawn(cmd, args, { stdio: 'ignore', detached: true });
    p.on('error', () => {});   // no opener on this machine (a computer without a desktop): the link is on the screen
    p.unref();
    return typeof p.pid === 'number';
  } catch { return false; }
}

/** Copy to the clipboard with what the machine has (pbcopy, wl-copy, xclip, clip); false when none worked. */
export function copyText(text, { platform = process.platform } = {}) {
  const tries = platform === 'darwin' ? [['pbcopy', []]]
    : platform === 'win32' ? [['clip', []]]
    : [['wl-copy', []], ['xclip', ['-selection', 'clipboard']]];
  for (const [cmd, args] of tries) {
    try {
      const r = spawnSync(cmd, args, { input: text, stdio: ['pipe', 'ignore', 'ignore'], timeout: OPENER_MS });
      if (!r.error && r.status === 0) return true;
    } catch {}
  }
  return false;
}
