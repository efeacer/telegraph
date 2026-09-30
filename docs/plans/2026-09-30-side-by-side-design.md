# Sessions side by side

Telegraph shows one session at a time, chosen in the sidebar. With several
agents at work, that means going from one to the next to see how each is
doing. Side by side, every session has a tile on the stage, and all of them
are in view at once.

```
┌ sidebar ──┬ ○ Shell  signal-box      Idle  × ┬ ▬ Claude  telegraph  Waiting ● × ┐
│ project   │ $ npm test                       │ > Should I go on?                │
│  ○ Shell  │ …                                │                                  │
│  ▬ Claude ├ ○ Codex  telegraph                                       Working  × ┤
│  ○ Codex  │ > building…                                                         │
└───────────┴─────────────────────────────────────────────────────────────────────┘
```

## Choosing

One at a time is how Telegraph starts. The button in the top right corner, or
View > Sessions Side by Side (⇧⌘G), changes to side by side and back. The
window remembers which it was left in. The sidebar stays in both.

## Side by side

- Every open session has a tile, in the order of the sidebar, whatever its
  project.
- Two columns up to four sessions, three up to nine, four beyond. The last
  session fills what would otherwise be left empty of its row.
- The head of a tile says which session it is, of which project, and what it
  is doing, and has the button that ends it.
- The tile the keys go to is outlined. Pressing a tile, or its session in the
  sidebar, makes it that one.
- While something is being chosen to start, the choice has the stage to
  itself, as it does otherwise. The tiles stay underneath, so that no
  terminal is told of a new size for it.
- The tile that has the keys is the one in front, however the keys got
  there. Ending another tile leaves them where they are.
- A tile is never smaller than a program can draw itself in. With more
  sessions than fit, the stage scrolls.
- From the thirteenth terminal on, the slower way of drawing is used: a
  browser only draws so many by GPU at once.

## Notices

A session that stops working is marked in its tile and in the sidebar. With
the window in front it is in plain view, so no notice of the system is shown
for it. With the window not in front, a notice is shown as otherwise.

## Terminals

A terminal is made once for a session and kept for as long as it lasts, with
all it has shown. It lives outside React. A tile is a place React lays out,
and the terminal is moved into it, and back out of sight when the tile goes.
So changing how sessions are laid out loses nothing, and each terminal fits
itself to the tile it is in and tells its program the new size.

Terminals that are not shown wait in a hidden place as large as the stage,
as they did before, so that they are of the right size when they are shown.

## Parts

| File | Role |
| --- | --- |
| `src/renderer/src/arrange.ts` | How many columns, and how many each tile takes |
| `src/renderer/src/components/Tile.tsx` | The place of a session on the stage |
| `src/renderer/src/components/Stage.tsx` | One tile, or all of them |
| `src/renderer/src/terminals.ts` | Moving a terminal into a tile and out of it |

## Testing

End-to-end tests start several sessions and check that they are next to each
other, that the keys go to the tile that was pressed, that a terminal is told
its new size, and that going back to one at a time keeps what was shown.
