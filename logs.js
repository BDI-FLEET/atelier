import { opVerb } from './ops.js';
await opVerb('logs', {
  usage: 'atelier logs [-f] [--since time] [-r remote]',
  options: [{ flag: '-f', also: '--follow', help: 'keep streaming' }, { flag: '--since', value: 'time', help: '1h, 30m, 45s, 2d, or a time (09:41, 2026-10-07T09:41)' }],
  op: ({ since, follow }) => ({ verb: 'logs', ...(since ? { since } : {}), ...(follow ? { follow } : {}) }),
  follow: ({ follow }) => !!follow,
});
