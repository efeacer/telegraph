# Attaching files

A program in a terminal is handed a file by its path. Telegraph types the
path, so that a screenshot can be given to an agent the way it is given to a
chat window: by dropping it or by pasting it.

## What can be attached

| What the user does | What Telegraph types |
| --- | --- |
| Drops files on a session | The path of each |
| Pastes files that were copied, in Finder for one | The path of each |
| Pastes an image that was copied, such as a screenshot | The path of a file it keeps the image in |
| Presses Ctrl+V | Nothing: the key goes to the program, which is how Claude Code is asked to look at the clipboard itself |

Text is pasted as before.

Paths are written the way a terminal writes a dropped file, with a backslash
before everything a shell would read as something else, and with a space
after each. They are typed as a paste, which tells the program that they did
not come from the keyboard.

This works with any program that takes the path of a file, not with Claude
alone.

## Images that are nowhere yet

An image on the clipboard has no path. Telegraph keeps it as
`pasted-2026-09-29-181012.png` in `telegraph-attachments` in the folder for
temporary files, readable by the user only. Images older than a week are
removed at start. The time in the name is UTC.

The image comes from the window, so the main process checks it before it
writes anything: only PNG, JPEG, GIF and WebP, and no more than 50 MB. The
name of the file is made by the main process, never taken from the window.

What cannot be attached, such as pasted data that is neither text nor an
image, is said in the window.

## Parts

| File | Role |
| --- | --- |
| `src/shared/paths.ts` | Writing a path as it is typed |
| `src/main/attachments.ts` | Keeping pasted images, removing old ones |
| `src/preload/index.ts` | Telling where a dropped file is |
| `src/renderer/src/terminals.ts` | Hearing of files that are dropped or pasted |
| `src/renderer/src/controller.ts` | Typing the paths into the session |

## Testing

- Unit tests for writing paths and for keeping images.
- End-to-end tests drop real files through the browser's own tooling, and
  paste with an event made for the test. They never touch the clipboard,
  which the user may be using.
- Checked once by hand with a real image on the clipboard, which was put
  back afterwards.
