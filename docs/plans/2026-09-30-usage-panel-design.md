# What was used

In the top right corner of the window a mark shows how much of the 5-hour
limit is used. It opens into a panel with the limits of the plan, the tokens
of today and of the week, and what the session in front has used.

```
                                                  ◔ 42%
  ┌────────────────────────────────────────────────────┐
  │     ◔ 42%                 ◔ 18%                     │
  │   5-hour limit          Weekly limit                │
  │   starts over in 2 h    starts over on Fri at 09:00 │
  │ ─────────────────────────────────────────────────── │
  │ Tokens today                                        │
  │ 1.19M                                               │
  │ 87K written, 1.1M read. Another 18.1M read again…   │
  │   ▂  ▃  ▁        █  ▂                               │
  │   Th Fr Sa Su Mo Tu Today                           │
  │ Fable 5.1                                    1.09M  │
  │ Haiku 4.5                                    98.7K  │
  │ ─────────────────────────────────────────────────── │
  │ This session, on Opus 5.5                           │
  │ ◔ 38% of its context is full                        │
  └────────────────────────────────────────────────────┘
```

The panel stays open until the mark is pressed again, and is open or
collapsed at the next start as it was left.

## Where the numbers come from

### The limits, and what a session has used

Claude Code hands what it knows of a session to the command of its status
line: how much of the 5-hour and of the weekly limit is used and when each
starts over, what the session has cost, how full its context is. This is
written down in its documentation, and needs neither the password of the
user nor anything sent anywhere.

Telegraph starts Claude with settings for the one session:

```
claude --settings '{"statusLine":{"type":"command","command":"…"}}'
```

The command writes what it is handed to the file named by
`TELEGRAPH_USAGE_FILE`, which Telegraph sets for every session to a file of
the session in `usage` in its user data folder. It prints nothing, so no
line of status shows in the session. The settings of the user are not
touched.

- The limits are those of the account. Chats in other terminals count
  towards them and show in them, as soon as a session started in Telegraph
  answers.
- A session knows a limit as of its last answer, and writes its report anew
  without knowing anything new. So the report written last is not the one
  that knows most. Telegraph goes by the stretch of time that is running
  now, and within it by the most that any session has seen used.
- When a session ends, what it knew of the limits is kept and the rest of
  its report is removed: a report also holds the folder and the name of the
  session, which Telegraph has no use for.
- A reading older than five minutes is said to be old.
- Claude Code reports the limits after its first answer, and only for plans
  that have them. Until then the panel says so.
- A limit whose time to start over has passed counts as unused.
- A status line the user or the project has set up is kept: settings for a
  session would take its place, so such sessions are not asked to report,
  and the panel says why it shows no limits. The main process decides this
  as each session is started.
- Launchers say whether their program reports: `"reports": { "kind": "claude" }`.

### The tokens

Claude Code keeps a record of every chat, and every answer in it says what
it took. Telegraph adds these up for the last seven days, by day and by
model, from all the records on the machine: chats in other terminals count
too, and so do the helpers of an agent.

- An answer is written on several lines, and into more than one record. It
  is counted once, by its last line.
- An answer is written as it is given, each line saying more than the one
  before. The most that any line says of it counts.
- Records are read on from where they were read to, a few megabytes at a
  time, so looking again costs next to nothing and a record of any length
  can be read. A week of records is some tens of megabytes and takes a
  fraction of a second the first time.
- A day is a day by the clock on the wall.
- The figure for a day counts what was written and what was read for the
  first time. What was read again from the cache is the same text over and
  over, many times the rest, and is told apart.

The records are not Telegraph's, and their form is not promised. What cannot
be read is left out.

### When the panel is brought up to date

When a session reports, which it does with every answer. Every half minute,
for what chats elsewhere have used. And when the panel is opened.

## The dials

A limit is one ratio against a bound, which a meter shows best, and the
request was for a round one. The fill tells how much is used, and its colour
how near the limit is: glass below 75%, brass from there, red from 90%. The
unfilled part is a dimmer step of the same colour.

Colour is never all that tells it: the figure is in the dial, and from 75%
the words "Running low" or "Nearly used up" stand under it. The three
colours are told apart by readers who see colours differently, and each
stands out from the panel and from its own track by three to one or more.

The week is seven columns, today in glass and the days before in grey. The
value of today is written on its column, the others show when pointed at or
reached by keyboard, and every one is said to a screen reader.

## What this does not do

- It knows nothing of Codex and Gemini.
- It does not say what was spent in money: a plan is not billed by tokens.
  The cost of a session at list prices is shown, as Claude Code reports it.
- A session started by typing `claude` in a shell does not report, since
  Telegraph did not start Claude and gave it no settings.

## Parts

| File | Role |
| --- | --- |
| `src/shared/usage.ts` | The settings Claude is started with |
| `src/main/meters.ts` | Reading what sessions report |
| `src/main/ledger.ts` | Adding up the tokens from the records |
| `src/renderer/src/components/Usage.tsx` | The mark and the panel |
| `src/renderer/src/format.ts` | Writing counts, times and the names of models |

## Testing

- Unit tests for the ledger and the meters read records and reports written
  for the test. The command of the status line is run by a real shell.
- End-to-end tests use a launcher that reports the way Claude Code does.
- Checked by hand: the command Telegraph puts together, run the way
  Telegraph runs it, had a real session of Claude report the limits of the
  plan, and showed no line of status.
