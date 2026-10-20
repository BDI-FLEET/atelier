/* atelier · every wait, size and count the CLI, the shell's backend processes and module-serve hold to, named once.
 * The page's own (ws-bridge.js, client.jsx) are named beside what they bound: the browser loads those files one by
 * one, and this one is not served to it. */

/* The host a machine signs in to when none is named: the port the host listens on in development. */
export const DEV_HOST_PORT = 4350;

/* How many bytes go in one piece when data or files move between here and a computer: 256 KiB, in base64 well under the 1 MiB one request into an op carries. */
export const PIECE = 256 * 1024;

/* How many files one ask names when files compares or places them: 500 entries stay well under one request into an op. */
export const FILES_PER_ASK = 500;

/* How many of the files a computer could not place a refusal names. */
export const MISSING_NAMED = 3;

/* How many times a file that came down broken is fetched: once more from the start, then the pull fails. */
export const FILE_TRIES = 2;

/* The largest JSON body a module's route reads; a larger one is refused 413 and not kept. */
export const MAX_JSON_BODY = 10 * 1024 * 1024;

/* The headers a backend's process and module-serve take: the shell's header (who is calling, as decided) passes node's 16 KiB default for a person in many workspaces. */
export const MAX_HEADER_BYTES = 4 * 1024 * 1024;

/* How long a sandbox waits on the computer's socket for the next line of an answer: a minute; a line that comes starts the wait again. */
export const SOCKET_ANSWER_MS = 60_000;

/* How long an op asked from a sandbox (run, logs, data, files) waits for its next line: fifteen minutes lets a quiet build or a long piece through. */
export const OP_QUIET_MS = 15 * 60_000;

/* The same for an op that follows (logs -f): a day of silence before it lets go. */
export const OP_FOLLOW_MS = 24 * 3_600_000;

/* How long a push asked from a sandbox waits for the computer's next line: the computer gives a push three minutes between two lines of its build. */
export const PUSH_QUIET_MS = 180_000;

/* How often login asks the host whether its code was approved. */
export const LOGIN_ASK_MS = 2000;

/* How long login waits for an approval when the host does not say when its code expires. */
export const LOGIN_CODE_MS = 10 * 60_000;

/* One frame of the spinner while login waits. */
export const SPINNER_MS = 100;

/* How long opening the browser or copying the code may take before login stops trying: the link and the code are on the screen anyway. */
export const OPENER_MS = 2000;

/* Keys typed within this long go to the host in one request, so a paste is one request and typing still feels live. */
export const ATTACH_KEYS_MS = 30;

/* A resize is told to the host once the window has stopped changing for this long. */
export const ATTACH_RESIZE_MS = 80;

/* The lines one notch of the mouse wheel scrolls, as terminals scroll. */
export const WHEEL_LINES = 3;

/* The widest the attach footer is padded to, so a very wide terminal does not get a line of spaces. */
export const FOOTER_COLUMNS = 200;

/* The size taken for a terminal that does not say its own: the classic 80 by 24. */
export const TERMINAL = Object.freeze({ cols: 80, rows: 24 });

/* The narrowest first column of a verb's help, so short flags still line up. */
export const HELP_COLUMN = 18;

/* How long a crashing backend gives its crash report to reach the shell before its process exits. */
export const CRASH_REPORT_MS = 500;

/* How long a stopping backend (in its own process, or in module-serve) gives its last messages to leave before it exits. */
export const STOP_FLUSH_MS = 20;

/* How long the shell lets a backend's process answer before it counts as stuck in a loop and is killed. */
export const BACKEND_LOOP_MS = 10_000;

/* How often the shell pings each backend's process. */
export const BACKEND_PING_MS = 2000;

/* How long a backend's process has to tear down before it is killed. */
export const BACKEND_STOP_MS = 2000;

/* The first wait before a backend's process that ended is started again; it doubles with each end. */
export const BACKEND_RESTART_FIRST_MS = 1000;

/* The longest wait before a backend's process is started again. */
export const BACKEND_RESTART_MAX_MS = 30_000;

/* A backend's process that stayed up this long starts its next restart from the first wait again. */
export const BACKEND_STEADY_MS = 60_000;

/* The hex characters of a module's hash in its socket's file name: short, as a socket path is at most about 100 characters. */
export const SOCKET_HASH_CHARS = 10;

/* The longest icon name a page of the host declares (a lucide name). */
export const PAGE_ICON_CHARS = 40;

/* The characters of a module's teaching page an agent is given: a page, not a manual, as it rides in the agent's context. */
export const TEACHING_CHARS = 16 * 1024;

/* The longest name a module declares: the name in the sidebar and the title. */
export const MODULE_NAME_CHARS = 64;

/* The longest tool name a module declares: an agent's model takes tool names of at most 64 characters. */
export const TOOL_NAME_CHARS = 64;

/* The longest name of an agent of a workspace. */
export const AGENT_NAME_CHARS = 32;

/* The longest key of an app's config. */
export const CONFIG_KEY_CHARS = 64;

/* The longest value of an app's config: the computer refuses a longer one. */
export const CONFIG_VALUE_CHARS = 4096;

/* The longest word for a computer or an app in a remote's path: the host refuses a longer one. */
export const REMOTE_WORD_CHARS = 80;

/* The longest label the host is given for an app made from its name. */
export const APP_LABEL_CHARS = 40;

/* How much of this machine's name goes to the host's record: a hostname is at most 64 characters. */
export const MACHINE_NAME_CHARS = 64;

/* The characters of a commit shown for a release, as git shortens it. */
export const SHORT_SHA_CHARS = 7;

/* An ISO time cut to the minute: the date, the T, the hours and the minutes. */
export const ISO_MINUTE_CHARS = 16;

/* The characters of a session's token shown to name it: enough to tell two apart, never enough to use one. */
export const TOKEN_SHOWN_CHARS = 8;
