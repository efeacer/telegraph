# telegraph

A terminal for prompting agents and tracking projects.

## Development

```sh
npm install
npm run dev
```

`npm test` runs the unit tests and `npm run test:e2e` the end-to-end tests.
`npm run install:app` packages the app and copies it to /Applications.

## Bug log

Telegraph records its crashes and errors in `logs/bugs.jsonl` in its user data
folder, and Help > Report a Bug… adds a note of your own. The log stays on
your computer and holds nothing from your terminals.

`npm run bugs` prints the recorded problems, grouped and most urgent first.
See [the design](docs/plans/2026-09-29-bug-log-design.md) for the details.
