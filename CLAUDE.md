# Telegraph

A terminal for prompting agents and tracking projects. Electron, React and
xterm.js, with sessions running in node-pty.

## Layout

- `src/main`: the main process. Sessions, the state file, the menu, the bug log.
- `src/preload`: the API the window gets, declared in `src/shared/types.ts`.
- `src/renderer`: the window. State lives in `store.ts`, actions in
  `controller.ts`, terminals outside React in `terminals.ts`.
- `src/shared`: code used on both sides.
- `e2e`: Playwright tests that drive the built app.
- `docs/plans`: designs, one per feature.

## Commands

| Command | Does |
| --- | --- |
| `npm run dev` | Runs the app with its own data, in `Telegraph Dev` |
| `npm run typecheck` | Checks the types |
| `npm test` | Runs the unit tests |
| `npm run test:e2e` | Builds the app and runs the end-to-end tests |
| `npm run bugs` | Prints the problems the app has recorded |
| `npm run install:app` | Packages the app and copies it to /Applications |
| `npm run install:when-closed` | Installs the packaged app once the user has closed Telegraph, and opens it again |

The end-to-end tests open a window per test. The windows stay in the
background and out of the Dock, because the user is often at work in the
installed Telegraph while the tests run: see `isE2E` in `src/main/index.ts`.
Keep it that way, and say so before running them.

`npm run install:app` refuses to run while Telegraph is open, because
replacing the app ends every session in it. Claude often runs inside
Telegraph and cannot close the app it runs in. To get a new version to the
user from there:

1. Run `npm run package`, and try the packaged app with a temporary
   `TELEGRAPH_USER_DATA`.
2. Run `npm run install:when-closed`. It waits in the background, for up to a
   day, until the user closes Telegraph. Then it replaces the app and opens
   it again. `-- --cancel` stops the waiting.
3. Tell the user that closing Telegraph ends the sessions in it, and that
   chats with an agent are continued from the agent's own record of them:
   "continue the last chat" in the project.

The app that was replaced is kept in `dist/previous`, and what happened is
written to `dist/install-when-closed.log`.

## Improving Telegraph from its bug log

Telegraph records its crashes, its errors and the bugs its user writes down.
The design is in `docs/plans/2026-09-29-bug-log-design.md`. When asked to
improve Telegraph, or to look at its bugs:

1. Run `npm run bugs`. It lists the open problems of the installed app and of
   development builds, most urgent first. Each has a fingerprint, a count, the
   builds it was seen in, and its latest stack and detail.
2. Pick a problem. The function names in a stack are the ones in `src`, since
   the build does not rename them. Line numbers refer to the bundles in `out`.
   A `bug-report` is a note from the user: reproduce what it describes first.
3. Write a failing test that shows the problem, then fix it.
4. Run `npm run bugs -- --resolve <fingerprint> "what fixed it"` and commit
   `docs/bug-log/resolved.json` with the fix.
5. The fix reaches the user with the next `npm run install:app`.

A resolved problem stays hidden while it only comes from builds made before it
was resolved. If `npm run bugs` says a problem CAME BACK, a build made after
the fix has met it again: the fix did not work, or did not cover every case.

Some entries are not bugs. An `unclean-exit` without crash dumps is often the
machine shutting down or a development run stopped with Ctrl-C. A
`session-failure` for a folder that does not exist is the user's folder having
moved. Resolve these with a note that says so, or leave them.

The log holds nothing from the terminals, and must stay that way: do not add
session output, typed input or session titles to entries.
