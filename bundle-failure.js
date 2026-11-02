/* Why a bundle the page imports did not load, in words a person can act on.
 *
 * The browser's import error says the same thing whatever happened, so the shell fetches the same address once and reads
 * the answer: no answer, an error status, a script the browser refused to run (a script blocker), or something that is
 * not a script. Plain module: the shell's client imports it, and so does its test. */

const WORDS = {
  unreachable: 'The host did not answer for {url}: {error}. Check the connection and reload.',
  answered: 'The host answered {status} for {url}.',
  signIn: 'Your session is not accepted. Sign in again.',
  notInstalled: 'This {what} is not installed on the host.',
  trouble: 'The host is in trouble. Try again in a minute.',
  blocked: "The host served the page's script, but your browser did not run it. A script blocker is on for {host} (Brave's Block scripts, NoScript or a similar extension). Allow scripts for {host} and reload.",
  notScript: 'The host answered {type} instead of a script for {url}.',
  noType: 'no content type',
  browserSaid: 'The browser said: {error}',
};

const STATUS_LINES = [
  [(s) => s === 401 || s === 403, 'signIn'],
  [(s) => s === 404, 'notInstalled'],
  [(s) => s >= 500, 'trouble'],
];

const fill = (sentence, values) => sentence.replace(/\{(\w+)\}/g, (_, name) => values[name]);
const messageOf = (err) => String(err?.message || err);

async function diagnose(url, fetchFn) {
  let res;
  try {
    res = await fetchFn(url, { credentials: 'same-origin', cache: 'no-store' });
  } catch (err) {
    return { kind: 'unreachable', lines: ['unreachable'], error: messageOf(err) };
  }
  if (!res.ok) {
    const status = `${res.status} ${res.statusText || ''}`.trim();
    const line = STATUS_LINES.find(([matches]) => matches(res.status));
    return { kind: 'answered', lines: line ? ['answered', line[1]] : ['answered'], status };
  }
  const type = res.headers.get('content-type');
  if (type && type.includes('javascript')) return { kind: 'blocked', lines: ['blocked'] };
  return { kind: 'notScript', lines: ['notScript'], type: type || WORDS.noType };
}

/** `{ kind, words }` for an import of `url` that failed with `importError`: `host` is the page's (`location.host`), `what` the
 *  name of the bundle in the not-installed line. */
export async function explainBundleFailure(url, importError, { host, what = 'chrome', fetchFn = fetch } = {}) {
  const { kind, lines, ...found } = await diagnose(url, fetchFn);
  const values = { url, host, what, ...found };
  const why = lines.map((key) => fill(WORDS[key], values)).join('\n');
  return { kind, words: `${why}\n\n${fill(WORDS.browserSaid, { error: messageOf(importError) })}` };
}
