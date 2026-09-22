# hidevalues

Hides values that look like secrets in Bash tool rows until the pointer is over them.
A `ui.render` hook on the `ToolUse` and `ToolResult` components takes every finished
Bash row, scans its stdout and stderr, and redraws the row with each hit painted in
the block colour on the same colour, so it reads as a bar. Hovering a hit shows it in
the reveal colour, underlined; moving away hides it again. A dim footer counts the
hidden values. Rows with nothing to hide, rows that are still running, and rows the
engine marks errored or interrupted are left to the engine.

## What is hidden

Both rules come from the Claude Mods case studies and are plugin policy, not engine
facts:

- a run of at least `min_length` characters from `A-Z a-z 0-9 + / _ = . -` whose
  Shannon entropy is at least `min_entropy` bits per character;
- anything shaped like an e-mail address, when `emails` is on.

Overlapping hits merge into one span. A run that contains `=` counts as one token, so
`KEY=value` is hidden whole when the whole run clears the thresholds.

## Options

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `min_length` | string (a number) | `20` | Shorter runs are never hidden. |
| `min_entropy` | string (a number) | `4.0` | Runs below this entropy are never hidden; 4.0 is the case study's threshold. |
| `emails` | boolean | `true` | Also hide e-mail addresses. |
| `hide_color` | string | `#3a3a3a` | Hidden text is drawn in this colour on this colour. |
| `reveal_color` | string | `#ffd700` | The text colour while the pointer is over a hidden value. |

Run it from a clone with

    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir mods/hidevalues

Hover needs the fullscreen terminal UI with mouse tracking. In the classic scrolling
UI Claude Code requests no mouse tracking from the terminal (only focus events;
measured 2026-09-22 with `CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1`), so nothing reveals
there; the hide itself draws the same way in both UIs, the tool row rewritten with
both values in the hide colour, one to a line, and the footer counting them.

## Measured

On Claude Code 2.1.278 in the fullscreen UI (2026-09-21), one Bash call printing a
fixture with a token and an e-mail address: the row was redrawn as
`● Bash(cat …)`, the token and the address inside the block colour, and the footer
`2 hidden values, hover one to reveal it`. Sweeping the pointer over the token
underlined it in the reveal colour; leaving it rewrote it without the underline; the
address behaved the same. In that terminal the engine raised `ToolUse` for the row and
never `ToolResult`, and a `ToolUse` rewrite replaces the whole row, header included,
which is why the hook draws the header too. `ToolResult` stays in the matcher for the
standalone-row case the declarations describe.

Re-measured on the committed build (`d19c6295`) on 2026-09-22 with a pointer sweep over
every row of a 40 by 140 fullscreen session (the estate's `claude_live_probe.py`):
before the sweep the token and the address were each drawn once, in the hide colour on
the hide colour, one to a line above the footer `2 hidden values, hover one to reveal
it`; each was rewritten in the reveal colour with an underline when the pointer reached
it and in the hide colour again when the pointer left. No other row of the tool output
revealed a value: the four rows around them answered only by redrawing the footer, and
the statusline mod loaded in the same session answered on its own bar row. In the
classic scrolling UI the same rows were drawn hidden the same way and, with no mouse
tracking requested, nothing was revealed.

The kit passes 7 of 7: the entropy and span policy (including the `min_length` floor,
which the first packaged build hardcoded at 20), the `ToolUse` and `ToolResult`
drawings, the rows that pass through, stderr drawn dim, the option wiring, and a
control that a hidden text with no scope is refused.

## Limits

- This hides from the eye, not from the data. Foreground equal to background is the
  whole hide: the value is still in the terminal byte stream, so scrollback, copy,
  `tmux capture-pane` and the transcript carry it, and the model received it in the
  tool result before the row was drawn. Rewriting the value out of the tool result
  itself, the model-side redaction of the case studies, is a separate mod and is not
  built.
- A collapsed tool group (`ran N shell commands`) draws no output, so there is
  nothing to hide until it is expanded.
- `PROBE_OUT` in the environment makes the hook dump each row it sees. It exists for
  measurement and is otherwise inert.
