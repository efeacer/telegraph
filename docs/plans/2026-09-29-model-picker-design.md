# Choosing an agent and a model

A session is started by choosing a program, such as Claude, Codex or Gemini,
and then the model it should run. Telegraph puts the two together into the
command it runs.

## Launchers

A launcher is a way to start a session. It gains three optional parts:

```json
{
  "id": "claude",
  "name": "Claude",
  "command": "claude",
  "modelFlag": "--model",
  "providers": ["anthropic"],
  "models": [{ "id": "opus", "name": "Latest Opus" }],
  "modes": [{ "id": "continue", "name": "continue the last chat", "args": "--continue" }]
}
```

| Part | Meaning |
| --- | --- |
| `modelFlag` | Goes before the model on the command line. Without it there is no model to choose |
| `providers` | The providers in the catalogue whose models the program runs |
| `models` | Models offered first, and the only ones offered without the catalogue |
| `modes` | Other ways to start than a new chat |

A launcher with none of them works as before, so launchers written by hand
keep working.

Telegraph comes with Shell, Claude, Codex and Gemini. The list is only written
to `state.json` once it differs from the one Telegraph comes with, so that a
newer Telegraph can bring newer launchers. A `state.json` that holds the
launchers of the first version, which were written out in full, is read as
holding none.

## The command

`claude --model 'claude-opus-5-5' --continue`: the command, the flag and the
model, then the arguments of the mode. The model goes first because programs
with subcommands, such as `codex resume`, take their own options before them.

The model is always quoted. Its name comes from the network or from the
keyboard and ends up in a shell.

## Models

Models come from three places, offered in this order:

1. **Its usual model.** No model is passed, and the program decides.
2. **The launcher's own models.** For Claude these are the names that always
   mean the latest model of a kind, which do not go out of date.
3. **The catalogue.** The models of the launcher's providers from
   [models.dev](https://models.dev), a public list that needs no key. Newest
   first, at most twelve.

A model that is in none of them can be typed in.

From the catalogue, Telegraph takes the models that can use tools and answer
in text, leaves out those marked as deprecated, and leaves out dated copies of
a model that is also listed without a date. Names that hold anything but
letters, digits and `. _ : / @ [ ] -` are left out as well. A list of more
than 32 MB is not read, and a provider that is missing from a newer list keeps
the models it had.

The catalogue is fetched by the main process at most once a day and kept in
`models.json` in the user data folder, cut down to the providers in use.
Without a network the copy on disk is used however old it is, and without a
copy only the launcher's own models are offered. Asking for the list sends
nothing about the user.

## Which programs are installed

At start, Telegraph asks the user's shell which of the programs it can find,
the same way a session would look for them: as a login shell that reads the
user's settings. Launchers whose program is missing are not offered.

Asking must never be what keeps Telegraph from starting:

- The shell gets nothing to read, so settings that ask a question go on
  without an answer.
- The shell is given five seconds and then ended. If it has not answered, or
  did not get to the end of looking, every launcher is offered.
- The window waits 400 ms for the answer. After that it offers every launcher
  and leaves out the missing ones when the answer arrives.
- A command that does not begin with a plain name or path, such as
  `~/bin/agent` or `(cd sub && claude)`, is offered without looking: only the
  shell could say what it runs.

## Remembering

Telegraph remembers per project which launcher was used last and, per
launcher, which model. The mode is not remembered: continuing a chat is a
choice made each time. A model that was typed in is remembered if its name
could be in the catalogue. If not, it runs, and the model chosen before stays
remembered.

The shortcuts and the menus start a launcher with the model remembered for it.

## In the window

A project without a session shows the choice as a sentence with blanks to
fill in, the way a telegram form has:

```
No session open in signal-box

Claude ▾  on  Latest Opus ▾  to  continue the last chat ▾

[ Start Claude ]
```

Each blank opens a list. The blanks for the model and the mode are only there
when the launcher has something to choose from. The project's menu in the
sidebar gains "Choose a model or a chat…", which shows this sentence while sessions are
open.

The lists are a listbox with a button, which the keyboard can open, move in
by arrow keys or by typing, and close.

## Parts

| File | Role |
| --- | --- |
| `src/shared/launchers.ts` | The launchers Telegraph comes with, putting a command together |
| `src/shared/models.ts` | Reading the catalogue, the list of models to offer |
| `src/main/catalogue.ts` | Fetching the catalogue and keeping it |
| `src/main/installed.ts` | Asking the shell which programs it finds |
| `src/main/store.ts` | Launchers and what was chosen last |
| `src/renderer/src/components/Select.tsx` | A blank and its list |
| `src/renderer/src/components/Picker.tsx` | The sentence |

## Testing

- Unit tests for the command, the list of models, reading the catalogue,
  keeping it, reading what the shell answers, and the state file.
- End-to-end tests with a launcher that prints its arguments: the model that
  was chosen reaches the command, a model can be typed in, the choice is
  remembered, a launcher whose program is missing is not offered. The
  catalogue is put on disk by the test, and the tests never use the network.
