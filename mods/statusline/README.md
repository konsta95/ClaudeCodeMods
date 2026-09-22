# statusline

[ClaudeCodeStatusline](https://github.com/konsta95/ClaudeCodeStatusline) as a
function-hook mod. The shell version is a `statusLine` command that Claude Code spawns
on every status-line update (a new assistant message is one trigger among session
start, `/compact`, permission-mode and vim-mode changes and timers, debounced at
300 ms), feeding it a JSON payload on stdin and printing the line it returns under the
prompt. This version runs inside the process: a `ui.render` hook on the `PromptHint`
site, the dim hint line under the prompt where the shell line drew, builds the same
segments from the session's own nouns (`$.session.cwd()`, `repo()`, `model()`,
`usage()`, `id()`), so there is no process to spawn and no payload to parse. Each
segment reveals its details when the pointer is over it, and `/statusline-mod` picks
the segments, their order and the options.

## What it draws

One row: the chosen segments separated by `|` and painted in the chosen scheme, then
the engine's own hint (`? for shortcuts`, `esc to interrupt`) dim after them. Claude
Code draws its own pills, such as the permission mode, to the left of the bar.

| Segment | On by default | Drawn as | Detail on hover |
| --- | --- | --- | --- |
| git branch | yes | `repo(branch)` from the nearest `.git/HEAD` (worktree `.git` files followed, at most 12 levels up); the directory name when there is no repository | repository, branch, GitHub `owner/name` from the remote, and the cwd |
| directory | no | the name of the current directory | the full path |
| branch | no | the branch alone | the branch and its repository |
| github | no | `owner/name` from the GitHub remote | the same |
| model | yes | the display name derived from the model id with its spaces removed, as the shell version prints it (`claude-opus-5-5[1m]` reads `Opus5.5`), then the effort level once a `turn.step` has carried one | the model id and the effort level |
| context | yes | `used/window` tokens, coloured by the percentage used | the token count and the percentage |
| 5h | yes | percentage of the five-hour window used | the exact percentage and when it resets |
| 7d | yes | percentage of the seven-day window used | the same for the weekly window |
| session | yes | the session id | the id, which is also the transcript file name |
| cost | yes | `$0.00` once the session has cost anything | the cost to four decimals |

A segment whose noun failed is drawn dim as `<id>!` with the error in its detail; a
segment with nothing to show yet (no cost, no rate-limit window) is left out. With
every segment off, the hint line is passed through unchanged.

With `details` on, hovering a segment shows its detail on a one-row card over the row
above the bar, which in the fullscreen UI is the prompt box's bottom rule, starting at
the bar's first column. The card is placed out of the layout, so showing it moves
nothing on screen.

The bar is rebuilt after `session.start` and after every `turn.complete`; `turn.step`
updates the effort level.

## /statusline-mod

In an interactive session `/statusline-mod` opens a dialog pane: a preview of the bar,
then a row per segment, the chosen ones first in their order and then the rest. A
digit toggles the segment on that row and ▲ ▼ move a chosen one; the line under the
prompt follows at once. Below them are the scheme, `h` for hover details, `p` for the
pinned copy, `r` to reset the segments and `q` to close; Esc closes it too.

The chosen segments and their order are kept in the plugin's store and persist across
sessions. The options are the plugin's own `/config` rows: the pane writes them, and
Claude Code reloads the mod with the new value.

`/statusline-mod show` prints the current line and options, and `/statusline-mod reset`
restores the default segments. In a non-interactive session the bare command prints
what `show` prints.

## Options

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `scheme` | `claude-code`, `codex` or `mono` | `claude-code` | The palette. `claude-code` uses the hues the shell version copied from the theme; `mono` paints nothing and dims every segment. |
| `details` | boolean | `true` | Reveal a segment's details on hover. Needs the fullscreen terminal UI with mouse tracking. |
| `pin_status` | boolean | `false` | Also pin the bar as plain text under the prompt through `$.ui.status`, where no hover is needed. |

Run it from a clone with

    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir mods/statusline

The mod neither reads nor changes the `statusLine` setting. To use it in place of the
shell version, remove the `statusLine` entry from `settings.json`.

## Measured

Claude Code 2.1.280, 2026-09-22. The mod rows come from three sessions, each on
Opus 5.5 in a 140 by 40 tmux pane with one short turn: two in the fullscreen UI and one
in the classic UI. The shell row is three runs of 30 spawns of the classic command
with a fixed payload on 2026-09-21.

| What | Value |
| --- | --- |
| Bar on screen after the process was spawned | 2.0 to 2.6 s (the screen was read every 0.5 s) |
| First render after `session.start` | 183 to 508 ms |
| Cold gather of the nouns, twice at start | 120 to 318 ms |
| Warm gather after a turn | 16 to 42 ms |
| Render of the hint line | median 0.47 ms, 0.21 to 11.13 ms, across 21 renders |
| Shell version, one `statusLine` spawn | 132.4 ms median of 30, with 122.0 and 137.1 ms in two other runs of 30 (bare `node` spawn 119.4 ms median of 30); paid on every status-line update, asynchronously and off the renderer's path, so not on the same clock as the render row |
| Kit, one run from this repository | first mount 91.1 ms, 200 cached renders median 1.41 ms, p90 2.07 ms, max 12.1 ms |

The hover reveal was observed in both fullscreen sessions. With all seven default
segments on the bar, the pointer was moved to the middle of each segment by writing
SGR mouse reports into the pane. Each position showed that segment's detail and no
other, on the row above the bar, and the bar stayed on the last row. With the pointer
off the bar, before and after, no detail was shown. The one other row that changed was
the engine's notice line, whose tmux focus-events notice was also on screen with the
pointer off the bar. The same sweep over the previous build, which laid the details
out in the hint line itself, showed the detail of three of the seven segments: each
reveal wrapped that line and shifted the bottom 15 rows of the screen, taking the bar
from under the pointer.

In the classic scrolling UI (`CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1`) the bar is drawn
in the same line, but tmux reported no mouse mode enabled by Claude Code, where the
fullscreen sessions had any-motion and SGR reporting on. No pointer position reaches
the session there, so nothing reveals.

## Limits

- Hover is applied by the terminal surface. No hook runs when the pointer moves, so
  the mod cannot observe or log a reveal, and the kit cannot test one; the kit tests
  check the tree (every segment names a scope, each scope has a card placed out of
  the layout over the row above, a malformed hover tree is refused).
- A card is one row. Claude Code clips an absolutely placed box at the edge of its
  region, so a detail longer than the room from the bar's first column to the right
  edge of the terminal is cut off there.
- The mods API gives the model id only; the display name is derived from it, and an
  id that is not `claude-*` is shown as it came.
- The effort level is unknown until the first `turn.step`. The `/config` rows are
  read once in case one carries it; in each measured session none of the 43 rows did.
- `PROBE_RUN` in the environment makes `turn.complete` write a JSON timing dump, under
  `out/<PROBE_RUN>` unless `PROBE_OUT` names another directory. Both exist for
  measurement and are otherwise inert.
