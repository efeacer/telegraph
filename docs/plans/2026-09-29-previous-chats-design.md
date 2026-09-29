# Going on with a chat that was had before

A chat with an agent outlives the session it was had in: the agent keeps a
record of it. Telegraph offers the chats of the selected project to go on
with, so that closing a session, or Telegraph itself, loses nothing that was
said.

## In the window

The blank for the chat lists, after the ways to start, the chats that were
had in the project:

```
Claude ▾  on  its usual model ▾  to  reopen “Telegraph crash logging” ▾

  start a new chat
  ─────
  continue the last chat
  pick a chat to resume
  ─────
  reopen “Telegraph crash logging”      5 minutes ago
  reopen “Fix the seat picker”          yesterday
```

The latest chat comes first, and at most fifteen are listed. A chat is found
by typing what it is called. The list is read each time the choice is shown.

The chat is opened in a session under the project, as the whole of what was
said and done in it: it is the agent that opens it, from its own record.

## Launchers

A launcher says how its program keeps chats:

```json
"chats": { "kind": "claude", "flag": "--resume" }
```

`kind` is whose way of keeping chats it is, and `flag` goes before the chat
on the command line: `claude --model 'opus' --resume '8267a48d-…'`. The chat
takes the place of the mode. It is quoted like the model is.

Telegraph can read the records of Claude Code. A launcher without `chats`
offers none.

## The records of Claude Code

Claude Code keeps a file for each chat, named by the id of the chat, in a
folder named after the folder the chat was had in:
`~/.claude/projects/-Users-someone-Projects-telegraph/<id>.jsonl`. If
`CLAUDE_CONFIG_DIR` is set, the records are there in place of `~/.claude`.

The records are not Telegraph's, and their form can change. So Telegraph
reads little of them, and what it cannot read it leaves out:

- The time a chat last went on is the time its file was last written.
- A chat is called by the title Claude Code gave it last, and failing that by
  the first thing the user said. Titles are cut to sixty letters.
- Only the start and the end of a file are read, since a record can be many
  megabytes.
- Left out are chats that a program had and no person, which plugins have to
  make summaries; chats of another folder whose name comes to the same; and
  what helpers of an agent said among themselves.

Which folder is read is decided by the main process from the project it
knows. The window names a project and a launcher, never a folder.

## What this does not do

- Telegraph does not open again by itself what was open when it was closed.
- A chat that is open in another session is offered too. Opening it twice has
  two programs write to one record.
- The chats of Codex and Gemini are not read.

## Parts

| File | Role |
| --- | --- |
| `src/main/chats.ts` | Reading the records of Claude Code |
| `src/shared/launchers.ts` | The command that opens a chat |
| `src/renderer/src/components/Picker.tsx` | Offering the chats |
| `src/renderer/src/format.ts` | Saying how long ago a chat went on |

## Testing

- Unit tests read records written for the test, and check the command.
- End-to-end tests keep their records in a folder of their own, by
  `CLAUDE_CONFIG_DIR`, and open chats with a launcher that says what it was
  started with.
- Checked by hand against the records of the user: each project offers the
  chats that were had in it.
