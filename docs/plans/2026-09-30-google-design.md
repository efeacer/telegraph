# Connecting Google, for every agent

The user presses Connect Google and signs in in the browser. From then on
every agent in Telegraph, Claude, Codex, Gemini or any other, can read their
calendars and their mail. Telegraph holds the key; the agents get answers.

## Signing in

Telegraph signs in as a desktop app, the way Google asks such apps to: it
opens the browser at Google's sign-in, and listens on this computer, at
127.0.0.1 on a port chosen at random, for the browser to come back with a
code. A proof made for this sign-in (PKCE) and a state that must come back
unchanged make sure the code is the answer to this very sign-in. The code is
traded for a key that renews itself.

Telegraph asks only to read: calendar.readonly and gmail.readonly, with
openid and email to know whose account it is.

The key is sealed with the keychain of the system (Electron's safeStorage)
before it is written to `google.json` in the user data folder. Disconnecting
removes it and tells Google to forget it. When Google has taken the access
back, Telegraph says so and asks to connect again.

Telegraph must be registered with Google for any of this; the README says how.
Without a registration, the button says what is missing.

## What is read

- Meetings: of every calendar the user shows, from now to the end of
  tomorrow, as single events, leaving out those cancelled and those declined.
  One meeting in two calendars is one meeting.
- Mail: found as Gmail's search box finds it, and read as text.

With Google connected, meeting reminders come from Google every ten minutes,
which is free. Without it, Telegraph asks Claude, as before, once an hour.

## The telegraph command

Every session is given a `telegraph` command, first on its PATH:

```
telegraph meetings [--days N]
telegraph mail search <query> [--max N]
telegraph mail read <id>
telegraph status
```

It is a small script run by the Node within Telegraph, so nothing needs to be
installed. It asks Telegraph over a socket of this run of Telegraph, readable
by the user alone, with a key made anew at each start and given only to
Telegraph's sessions. So the key to the Google account never leaves
Telegraph, and a program outside Telegraph cannot ask.

Any agent can run a command, so every agent can read the day. The companion is
told of the command in its instructions, which are written for Claude
(CLAUDE.md), for Codex and others (AGENTS.md) and for Gemini (GEMINI.md).

## The companion, as any agent

The companion is the agent chosen for it last, or else the first installed of
Claude, Codex and Gemini. It goes on with its last chat where its agent keeps
chats Telegraph can find, which Claude does.

## Parts

| File | Role |
| --- | --- |
| `src/main/google/oauth.ts` | Signing in: PKCE, listening for the code, the key |
| `src/main/google/account.ts` | The account: connecting, the sealed key, reading |
| `src/main/google/api.ts` | Reading what Google answers |
| `src/main/google/client.ts` | How Telegraph is registered |
| `src/main/bridge.ts` | Where the command asks |
| `resources/cli/telegraph.cjs`, `resources/bin/` | The command |
| `src/renderer/src/components/Connections.tsx` | The pane |

## Testing

End-to-end tests run against a stand-in Google on this computer: they sign
in through the whole round trip, get a reminder of a meeting, and run the
telegraph command in a session. The keychain is not asked under test.
