# Bug log

Telegraph keeps a record of what goes wrong in it, so that the problems can be
read back later and fixed. The reader is usually Claude, working in this
repository: it runs `npm run bugs`, picks a problem, fixes it, and marks it as
resolved.

## What is recorded

Every entry is one line of JSON in `<userData>/logs/bugs.jsonl`. The installed
app and development builds have separate user data folders, so they have
separate logs.

| Kind | Recorded when |
| --- | --- |
| `main-error`, `main-rejection` | The main process throws or rejects without a handler |
| `ipc-error` | A request from the window fails in the main process |
| `session-failure` | A session could not be started |
| `state-unreadable` | `state.json` could not be read and was set aside |
| `window-error`, `window-rejection` | The window throws or rejects without a handler |
| `render-error` | React could not draw the window |
| `console-error` | The window logs an error to its console |
| `window-crash`, `child-crash` | The window's process or a helper process dies |
| `window-unresponsive` | The window stops responding |
| `load-failure`, `preload-error` | The window's page or preload script fails to load |
| `unclean-exit` | The previous run ended without shutting down |
| `bug-report` | The user writes a note with Help > Report a Bug… |

An entry holds the time, the run it belongs to, the kind, a message, a stack
when there is one, a few facts about the situation, and the build it came from
(version, build time, packaged or not, Electron version, platform).

Entries never hold anything read from or typed into a terminal, nor the
titles programs give their sessions. The log never leaves the machine.

## Keeping the log readable

- **Fingerprints.** Each entry carries a fingerprint made from its kind, its
  message and the function names at the top of its stack. Numbers, ids and
  paths are left out, so the same bug has the same fingerprint across runs
  and builds.
- **Repeats.** A bug in a timer could write thousands of entries. Within one
  run, a fingerprint is written the first three times and then on every tenth
  power (10, 100, 1000), each with its count so far.
- **Size.** When `bugs.jsonl` passes 512 KB it becomes `bugs.1.jsonl`,
  replacing the older one.
- **Limits.** Messages, stacks and notes are cut to a fixed length. Reports
  from the window are checked before they are written.

Writes are synchronous, so that an entry reaches the disk before the process
that is reporting it dies. Problems are rare, so this costs nothing in
practice. The log itself never throws: if the entry cannot be written, it is
dropped.

## Crashes

- Electron's crash reporter is started without uploading, which keeps native
  crash dumps in the user data folder.
- A marker file, `logs/running.json`, is written at start and removed on a
  clean quit. A marker found at start means the last run crashed or was
  killed. That becomes an `unclean-exit` entry, which names the crash dumps
  written since that run began.
- An uncaught error in the main process is logged, and shown to the user once
  per fingerprint. The app keeps running, because ending it would end every
  session in it.
- An error while drawing the window replaces the window with a short message
  and a button to reload.

## Reporting a bug by hand

Most bugs do not throw. Help > Report a Bug… (⇧⌘B) opens a dialog with one
text field. The note is saved as a `bug-report` entry along with the number of
projects and the launcher and status of each session.

Help > Show Bug Log reveals the log in Finder.

## Reading the log

`npm run bugs` reads the logs of the installed app and of development builds
and prints the problems grouped by fingerprint: crashes first, then bug
reports, then errors.

- `--json` prints the groups as JSON.
- `--all` includes resolved problems.
- `--dir <folder>` reads another log folder.
- `--resolve <fingerprint> [note]` records a problem as fixed in
  `docs/bug-log/resolved.json`, which is committed with the fix.

A resolved problem is hidden as long as it only comes from builds made before
it was resolved. If a newer build reports it, it is shown again and marked as
having come back.

## Parts

| File | Role |
| --- | --- |
| `src/shared/buglog.ts` | Entry types, limits, turning any thrown value into a message and a stack |
| `src/main/buglog.ts` | Writes entries: fingerprints, repeats, rotation, the running marker |
| `src/main/watch.ts` | Connects the process, the app and the window to the log |
| `src/renderer/src/problems.ts` | Reports the window's errors to the main process |
| `src/renderer/src/components/ErrorBoundary.tsx` | Catches errors while drawing |
| `src/renderer/src/components/BugReport.tsx` | The dialog for notes |
| `scripts/bugs.mjs`, `scripts/lib/digest.mjs` | The digest |

## Testing

- Unit tests for the log, the description of thrown values and the digest.
- End-to-end tests: an error thrown in the window reaches the log, a note
  written in the dialog reaches the log, and a killed app is reported as an
  unclean exit by the next run.
