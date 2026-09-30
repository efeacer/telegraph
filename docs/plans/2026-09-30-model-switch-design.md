# The model of a session

Every session shows the model it runs on, and the model of the session in
front can be changed without ending it.

## Where it shows

- In the sidebar, after what the session is doing: `Idle · Opus 5.5`.
- In the head of its tile, side by side.
- In the header of the stage, for the session in front. Where the model can
  be changed, it is a blank that opens a list.

The name is the one the session reports, which is the model it really runs
on, however it was changed: from Telegraph, or by the user typing `/model`.
Until a session reports, and for programs that do not, it is the model that
was chosen when the session was started. A session started on "its usual
model" that does not report shows no model.

## Changing it

A launcher says what to type into a running session to change its model:

```json
"modelCommand": "/model"
```

Choosing a model types `/model claude-opus-5-5` and Enter into the session,
as the user would. The list is the one offered when a session is started.
The model is remembered for the next session of the launcher in the project.

Tried with Claude Code 2.1.285: the model changed, and the session reported
the new one within two seconds.

It is not done:

- while the agent works, which would take the command for a message;
- while something has been typed into the session and not sent, which the
  command would be added to. Enter sends it, and Ctrl-C or Ctrl-U clear it;
- in a session that has ended.

In each case the window says why, and nothing is typed.

Only Claude has a `modelCommand` among the launchers Telegraph comes with.
Codex and Gemini have a `/model` of their own, which opens a list rather
than taking a name, and were not tried.

## Parts

| File | Role |
| --- | --- |
| `src/renderer/src/components/ModelSwitch.tsx` | The model in the header, and its list |
| `src/renderer/src/controller.ts` | `switchModel`, and telling whether something is typed |
| `src/renderer/src/store.ts` | `modelOf`: the name to show |
