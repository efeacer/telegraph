# Attaching files

A program in a terminal is handed a file by its path. Telegraph types the
path, so that a file or a folder can be given to an agent the way it is given
to a chat window: by dropping it, by pasting it, or with the Attach button.

## What can be attached

| What the user does | What Telegraph types |
| --- | --- |
| Drops files or folders on a session | Where each is |
| Pastes files or folders that were copied, in Finder for one | Where each is |
| Presses Attach in the header and chooses files or folders | Where each is |
| Pastes a file that is nowhere yet, such as a screenshot | Where a file is that it keeps it in |
| Presses Ctrl+V | Nothing: the key goes to the program, which is how Claude Code is asked to look at the clipboard itself |

Text is pasted as before. A folder ends in a slash, so that it is not taken
for a file.

## How it is written

Each launcher says how, by `attachAs`:

| `attachAs` | Written as | For |
| --- | --- | --- |
| `path`, the default | `/Users/ada/notes\ file.txt`, as a terminal writes a dropped file | Shells, and any program that takes a path |
| `mention` | `@/Users/ada/notes.txt`, or `@"/Users/ada/notes file.txt"` | Claude, which reads a file or folder that is mentioned into the chat |

Claude was tried by hand (2.1.285). It reads `@path`, and `@"path"` for a path
with spaces, files and folders alike, with or without the slash. It does not
read a mention with backslashes in it. So a path with a `"` in it is written
as a path, which Claude can still be asked to read. An image is written as a
path too: Claude takes in a path to an image as the image itself.

Mentions are typed with a space before them, so that a mention does not join
the word typed before it. Everything typed has a space after it. It is typed
as a paste, which tells the program that it did not come from the keyboard.

Codex and Gemini are given paths. Gemini has `@` too, but has not been tried.

## Files that are nowhere yet

A file on the clipboard that came from no folder, such as a screenshot, has
no path. Telegraph keeps it in `telegraph-attachments` in the folder for
temporary files, readable by the user only, as
`pasted-2026-09-29-181012-report.pdf`: the time in UTC, then what can be kept
of the name it had. That is letters, digits and `. _ -`, so that it needs no
escaping and leads to no other folder. The clipboard names every image
`image.png`, which is left out. Its ending comes from the name, or from its
kind, or is `.bin`. Files older than a week are removed at start.

The file comes from the window, so the main process checks it before it
writes anything: it must be data, and no more than 50 MB.

What cannot be attached is said in the window.

## Parts

| File | Role |
| --- | --- |
| `src/shared/paths.ts` | Writing a path as a shell or an agent reads it |
| `src/main/attachments.ts` | Keeping pasted files, removing old ones, telling folders from files |
| `src/main/index.ts` | The chooser behind Attach |
| `src/preload/index.ts` | Telling where a dropped file is |
| `src/renderer/src/terminals.ts` | Hearing of files that are dropped or pasted |
| `src/renderer/src/controller.ts` | Typing the paths into the session |

## Testing

- Unit tests for writing paths and mentions, for keeping files, and for
  telling folders from files.
- End-to-end tests drop real files and folders through the browser's own
  tooling, and paste with an event made for the test. They never touch the
  clipboard, which the user may be using. A launcher with `attachAs: mention`
  that keeps what it is given shows what an agent would get. Under test the
  chooser opens no dialog: `TELEGRAPH_TEST_ATTACH_PATHS` names what is chosen.
- Checked once by hand with a real image on the clipboard, which was put
  back afterwards, and with real Claude reading mentioned files and folders.
