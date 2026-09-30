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

## Pause, stop and end

Every session has a pause button, which freezes it where it is until you
resume it, and a stop button, which stops what it is doing as Esc does and
keeps the session open. The × ends it. They are in its row, its tile, and the
header, and in the Session menu (⇧⌘P and ⌘.).

## Connecting Google

Press **Connections** at the foot of the sidebar, then **Connect Google**, and
sign in in the browser. From then on your agents can read your calendars and
Gmail, whatever agent they are, with the `telegraph` command:

```sh
telegraph meetings
telegraph mail search from:ada newer_than:7d
telegraph mail read <id>
```

Telegraph only reads: it sends, changes and deletes nothing. The key to your
account is kept in the macOS keychain, and never given to an agent.

### Registering Telegraph with Google, once

Google lets an app ask for sign-ins only once it is registered. Whoever builds
this copy of Telegraph does this once; everyone who uses it then just presses
Connect Google.

1. Open [console.cloud.google.com](https://console.cloud.google.com) and create a
   project named Telegraph.
2. In **APIs & Services → Library**, enable the **Google Calendar API** and the
   **Gmail API**.
3. In **Google Auth Platform**, set up the app: name Telegraph, audience
   **External**, and your own email as contact. Under **Audience**, add
   yourself as a test user.
4. Under **Clients**, create a client of type **Desktop app**, and download its
   JSON file.
5. Save the file as `resources/google-oauth.json` in this repository, then run
   `npm run package` (or save it as `google-oauth.json` in Telegraph's data
   folder, `~/Library/Application Support/Telegraph`, and restart Telegraph).

While the app is in testing, Google asks for the sign-in again every seven
days. Setting it to **In production** under **Audience** ends that; Google then
shows a warning that the app is not verified, which is fine for your own use.
Giving Telegraph to many people needs Google's verification, since Gmail is a
restricted scope.

## The companion

At the top of the sidebar is a Claude chat that is always open. It knows your
meetings, your mail and what your sessions are doing, through the connectors
of your Claude account. Half an hour before a meeting Telegraph offers its
help, and pressing the notice asks it to help you prepare. Connections… in
its menu shows what it can reach, and where to add more.

## Renaming a chat

Double-click the name of a session, or press ⇧⌘R, to rename it. Claude is
told the new name too, so the chat keeps it when it is reopened later.

## Themes

Night, Dark, Light and Creme, chosen at the foot of the sidebar or in
View > Theme. The terminals change with the window.

## The model of a session

Every session shows its model in the sidebar and in its tile. For a Claude
session, the model in the header opens a list to change it without ending
the session, once the agent waits for you and nothing is half typed.

## Sessions side by side

The button in the top right corner, or View > Sessions Side by Side (⇧⌘G),
lays all open sessions out next to each other, each in a tile. Press it again
to go back to one session at a time.

## Notifications

When a session you are not looking at stops working, rings its bell or ends,
Telegraph shows a notification, counts it on its icon, and marks the session
in red until you go to it. Pressing the notification takes you there. This
works for any program, since it goes by what the terminal sees.

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
