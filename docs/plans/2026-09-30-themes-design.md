# Themes

Four themes: Night, the slate blue Telegraph was drawn in; Dark, graphite
without the blue; Light, paper in daylight; and Creme, warm like a telegram
form. Chosen at the foot of the sidebar or in View > Theme, and kept in
`state.json`.

## How a theme is made

Every colour of the window is a token in `styles.css`, set once for each
theme under `:root[data-theme='…']`. The names come from the Night theme:
`--night` is the colour of the sidebar and the header in every theme,
`--paper` that of text, `--well` that of the terminals. Drop shadows, the dim
behind a dialog and the text on a red badge are tokens too.

The terminals take their colours from `src/shared/themes.ts`: their
background and text are the `--well` and `--paper` of the theme, and their
sixteen colours are stepped to be read on it. On the light themes the
colours are darker, as the marks of the window are.

A test holds the themes to this:

- every theme sets every token that Night sets;
- text reads at 7:1 on every surface, quiet text at 4.5:1;
- glass, brass and red stand out at 3:1 from the sidebar and from panels;
- the terminal is of the colours of the window, its text reads at 7:1, and
  every colour a program writes with at 3:1.

## Changing the theme

The main process keeps the theme. It gives it to the window before the page
is drawn, so the page is never drawn in the colours of another theme, and
colours the window itself with it, so that nothing flashes at start. A theme
chosen in the window or the menu is kept, and told to the page, the menu and
every terminal. A theme chosen while the page loads is told again once it
has loaded.

## Parts

| File | Role |
| --- | --- |
| `src/shared/themes.ts` | The themes, and the colours of the terminals |
| `src/renderer/src/styles.css` | The colours of the window in each theme |
| `src/main/index.ts` | Keeping the theme, the colour of the window, the menu |
| `src/renderer/src/terminals.ts` | Colouring the terminals anew |
