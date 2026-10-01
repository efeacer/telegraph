# Several windows

Telegraph opens as many windows as the user asks for, as a terminal does.
Each window has its own sessions, layout and focus. Projects, the theme, the
accounts and what was used are shared.

## Opening a window

- Session > New Window (⇧⌘N), and New Window in the menu of the Dock icon.
- Starting Telegraph again, from Finder, the Dock or a terminal, opens a
  window in the Telegraph that runs, rather than a second Telegraph.

A second Telegraph of its own would write the same state file, keep the same
records, start its own companion and tell of every meeting twice. One
Telegraph with several windows does none of that.

A new window opens a little below and to the right of the one in front, at
its size.

## Sessions belong to their window

The main process keeps, for every session, the window it was started in.
What a session prints goes to its window only, and only its window may type
into it, resize it, pause it or end it.

- Closing a window ends its sessions, and asks first when any of them runs a
  program. Quitting asks once for all windows.
- Reloading a window ends its sessions only.
- The count on the icon adds up what is new in every window.
- Pressing a notice brings the window of its session to the front.
- The menu acts on the window in front.

## One companion

The companion lives in one window: the first opened of those still open. The
other windows do not show it. When its window is closed, the oldest window
left takes it over and starts it, going on with its last chat.

## What is shared

Projects added or removed in one window are shown in the others. The theme,
Google and the usage panel are the same in all of them.
