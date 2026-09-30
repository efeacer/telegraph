# telegraph

A terminal for prompting agents and tracking projects.

## Development

```sh
npm install
npm run dev
```

`npm test` runs the unit tests and `npm run test:e2e` the end-to-end tests.
`npm run install:app` packages the app and copies it to /Applications.

## Agents and models

A session is started by choosing an agent, the model it runs on, and whether
to continue a chat. Telegraph comes with Claude, Codex and Gemini, and offers
the ones it finds installed. Their models come from
[models.dev](https://models.dev), a public list that needs no key.

To add an agent of your own, add `launchers` to `state.json` in Telegraph's
user data folder. Once the file has launchers, only those are offered, so
list every one you want:

```json
{
  "launchers": [
    { "id": "shell", "name": "Shell", "command": null },
    {
      "id": "aider",
      "name": "Aider",
      "command": "aider",
      "modelFlag": "--model",
      "providers": ["openai", "anthropic"],
      "models": [{ "id": "sonnet", "name": "Sonnet" }],
      "modes": [{ "id": "restore", "name": "restore the chat history", "args": "--restore-chat-history" }]
    }
  ]
}
```

Only `id`, `name` and `command` are needed. See
[the design](docs/plans/2026-09-29-model-picker-design.md) for the rest.

## What was used

The mark in the top right corner shows how much of the 5-hour limit of your
plan is used. It opens into a panel with the limits, the tokens of today and
of the last week by model, and the cost and context of the session in front.

The limits come from Claude Code itself, which reports them to sessions
started in Telegraph. The tokens are added up from the records Claude Code
keeps on this computer. Nothing is sent anywhere.

## Going on with a chat

The chats Claude has had in a project are offered where a session is started,
by what they are called and when they last went on. Choosing one opens it
again in full, in a session under the project.

## Attaching files

Drop a file on a session, or paste one, and Telegraph types its path for the
program that is running. A screenshot that was copied is kept as a file
first. Ctrl+V goes to the program itself, which is how Claude Code looks at
the clipboard.

## Bug log

Telegraph records its crashes and errors in `logs/bugs.jsonl` in its user data
folder, and Help > Report a Bug… adds a note of your own. The log stays on
your computer and holds nothing from your terminals.

`npm run bugs` prints the recorded problems, grouped and most urgent first.
See [the design](docs/plans/2026-09-29-bug-log-design.md) for the details.
