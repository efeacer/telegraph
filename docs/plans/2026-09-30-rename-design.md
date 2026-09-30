# Renaming a chat

A session is called by what its program calls it, which for Claude is a
title it makes up, or by the name of its launcher. The user can give it a
name of their own.

## Where

Double-click the name of a session in the sidebar or in its tile, or choose
Session > Rename Session… (⇧⌘R) for the session in front. Enter keeps the
name, Escape gives it up, and an empty name goes back to what the program
calls the session.

The name is shown wherever the session is: the sidebar, its tile, the
header, and the notices of the system. It comes before any title the program
sets for its terminal.

## Kept by the agent

A launcher can say how its program is told to rename the chat:

```json
"renameCommand": "/rename"
```

For Claude, Telegraph then types `/rename <name>` into the session. Claude
keeps the name in its own record of the chat, as a line of type
`custom-title`, so that it outlives the session: the list of chats to
reopen shows it, before any title Claude made up. Tried with Claude Code
2.1.285.

The name is typed only when that cannot go wrong: not while the agent works
or has just been sent something, nor while something is typed and not sent.
Until then it waits, and it is typed once the agent is waiting for the user.

A name is one line of at most a hundred characters, without keys a terminal
would act on.

A name that is cleared is not told to the agent, which keeps the last name
it was given.

## Parts

| File | Role |
| --- | --- |
| `src/shared/names.ts` | Making a name fit to show and to type |
| `src/renderer/src/components/NameField.tsx` | Typing the name in its place |
| `src/renderer/src/controller.ts` | Renaming, and telling the agent when it can be |
| `src/main/chats.ts` | Reading the name from the record of a chat |
