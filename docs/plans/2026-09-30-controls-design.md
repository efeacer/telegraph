# For everyone, developers or not

Telegraph is used by people who write code and people who do not. It is one
app for both: nothing is hidden, but nobody has to type a command to get
started, and every control says what it does.

## Pause, play, stop, end

Every session has, in its row in the sidebar, in its tile, and in the header
when it is in front:

| Control | Does |
| --- | --- |
| Pause | Freezes the program where it is, and whatever it runs |
| Resume | Lets it go on from where it was |
| Stop | Stops what it is doing, as Esc does in an agent and Ctrl-C in a shell. The session stays open |
| End (×) | Ends the session |

In the header Pause is a button with words; in a row or a tile, an icon that
says what it does when pointed at. Stop has no button, since the × beside a
session already ends it: it is in the menu, as Session > Stop What It Is
Doing (⌘.), with Pause or Resume (⇧⌘P).

Pausing sends SIGSTOP to the program and every process it started, and
resuming SIGCONT. An agent that is frozen for long can lose its connection to
the model, which is why Stop is there besides. A paused session is shown as
Paused, with a mark of two bars, and is never taken to be waiting for the
user. Windows has no way to freeze a program; there Pause says so.

A launcher says which key stops its program: `"interruptKey"`, Esc for the
agents Telegraph comes with, Ctrl-C otherwise.

## Saying what things are

- A welcome for someone new: what Telegraph is, and three steps, each with
  its button: add a project, start an agent, connect Google.
- Icons beside the words at the foot of the sidebar: Add project,
  Connections.
- Plain words where there were terms: "Choose an agent to work with in this
  folder, or a shell to type commands yourself."
