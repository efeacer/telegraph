# The companion

A chat that is always open in Telegraph, at the top of the sidebar. It knows
the user's day, their meetings and their mail, and what their sessions are
doing, and it offers help before a meeting without being asked.

## What it is

The companion is Claude, in a folder of its own in Telegraph's user data
folder. Telegraph starts it by itself when it opens, without bringing it to
the front, and it goes on with the chat it had before, so that it remembers
what was said. It is the first entry of the sidebar and cannot be removed.

Telegraph writes two files into its folder:

- `CLAUDE.md`, its brief, which Claude reads as its instructions: what it is
  for, where to look, and that it never sends mail or changes the calendar
  unless the user asks in so many words.
- `context.md`, kept up to date: the time, the meetings Telegraph knows of,
  and what each session is doing, on which model.

## Where the calendar and the mail come from

From the connectors of the user's Claude account, such as Google Calendar,
Gmail and Google Drive. Claude reaches them with the user's sign-in, and
Telegraph never holds a key to them. Connecting another calendar or mailbox,
such as Outlook or iCloud, is done in the connector settings of the Claude
account, and the companion can use it from then on.

A connector can be connected to the account and still need a sign-in
before Claude Code may read it. Telegraph finds that out when it asks, and
says so.

## Telling of meetings before they start

Telegraph needs to know when the meetings are without being prompted. Every
hour, and at start, it asks Claude in the background, with Haiku and only
the calendar tools, for the meetings until the end of tomorrow. Claude
answers with one line of JSON, which Telegraph checks and keeps on disk.

Half an hour before a meeting, a notice says so and asks whether to help.
Pressed, it brings Telegraph to the front and asks the companion to help
prepare: what the meeting is about, who is coming, and what in the mail or
calendar to know. Each meeting is offered once, also across restarts.

The question is typed into the companion once that cannot go wrong: not
while it works or starts, nor while something is typed into it and not sent.

Each hourly question costs about three cents at list prices, and counts
towards the limits of a plan.

## Connections

Pressing what the companion shows under its name, or Connections… in its
menu, opens a dialog with:

- the calendar: when it was last read and how many meetings, or why it
  could not be; a button to read it now, and to sign in, which opens the
  connectors in the companion;
- the connectors Claude Code lists for the account;
- where to add others.

## What this does not do

- Only the calendar is read in the background. The mail is read by the
  companion when it is asked.
- It is Claude only: the companion needs Claude Code.
- The first time, Claude asks whether to trust the companion's folder. The
  user answers that in the companion.

## Parts

| File | Role |
| --- | --- |
| `src/shared/agenda.ts` | Reading the meetings from the answer, which to offer help with |
| `src/main/agenda.ts` | Asking Claude every hour, keeping the meetings, telling of them |
| `src/main/companion.ts` | The brief, the context, the connectors |
| `src/renderer/src/controller.ts` | Starting the companion, asking it, telling it of the sessions |
| `src/renderer/src/components/Connections.tsx` | The dialog |

## Testing

Under test Claude is never asked: what it would answer about the meetings
and the connectors is in files of the test. Checked by hand once: the
question Telegraph asks, run as Telegraph runs it, answered in under five
seconds that the calendar needs a sign-in.
