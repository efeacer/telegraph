# Telling the user of a session

An agent works for minutes while the user does something else. When it stops,
because it is done or because it has a question, Telegraph says so: by a
notice of the system, a count on its icon, and a red mark on the session that
stays until the user goes to it.

## When there is something to tell

| What happened | Told as |
| --- | --- |
| A session that was working went quiet, and nobody was looking | "Waiting for you in <project>" |
| A session rang the bell, and nobody was looking | "Waiting for you in <project>" |
| A session ended, and nobody saw it end | "Ended in <project>" |

"Nobody was looking" means that the window was not in front, or that another
session was. Nothing is told of the session the user is looking at.

This is read from what a terminal can see of any program: text that keeps
coming means work, the silence after it means the program waits. It needs
nothing from the agent, so it holds for Claude, Codex, Gemini, a build in a
shell, and whatever comes next.

Claude Code could say more exactly why it stopped, through hooks. Hooks given
for one session take the place of the hooks the user has set up, so that is
not done.

## How it is told

- **A notice of the system**, with the name of the session as its title.
  Pressing it brings Telegraph to the front and goes to the session. A
  session has one notice at a time, and it is taken back when the user goes
  to the session by another way.
- **A count on the icon**: on the Dock on macOS, on the launcher on Linux
  where that is supported. Windows has no count, and gets a red mark laid
  over the icon in the taskbar, and a flashing taskbar button.
- **In the window**: a red mark on the session and a red count on its
  project, until the user goes to the session or types into it.

The window decides what there is to tell, since it is the window that knows
what each session is doing and which one is in front. The main process shows
it, and checks what it is handed: the id of a session, and two lines of text
cut to length.

All of it goes through what Electron offers on every system, so nothing here
is of one system alone. Windows needs an app to say what it is called before
it shows its notices, which Telegraph does at start.

## What this does not do

- It does not reach a phone, or a computer other than the one Telegraph runs
  on.
- It does not tell finishing from asking: both read as "waiting for you".
- Notices can be turned off in the settings of the system, not in Telegraph.
- It is built and tried on macOS. Telegraph itself is only packaged for
  macOS so far, so on Windows and Linux this is written by the book and not
  tried.

## Parts

| File | Role |
| --- | --- |
| `src/shared/notices.ts` | What there is to tell, how it is worded, checking a notice |
| `src/main/notifier.ts` | Showing notices, taking them back, the count on the icon |
| `src/main/index.ts` | What each system offers for that |
| `src/renderer/src/controller.ts` | Marking sessions as they change, and as the user goes to them |

## Testing

Under test no notice is shown and the app is not brought to the front: the
tests run while the user is at work. The notices are kept in the main process,
where the tests read them and press them.
