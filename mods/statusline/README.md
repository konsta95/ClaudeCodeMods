# statusline

[ClaudeCodeStatusline](https://github.com/konsta95/ClaudeCodeStatusline) as a
function-hook mod. The shell version is a `statusLine` command that Claude Code spawns
on every status-line update (a new assistant message is one trigger among session
start, `/compact`, permission-mode and vim-mode changes and timers, debounced at
300 ms), feeding it a JSON payload on stdin and printing the line it returns under the
prompt. This version runs inside the process: a `ui.render` hook on
the `AbovePrompt` band builds the same segments from the session's own nouns
(`$.session.cwd()`, `repo()`, `model()`, `usage()`, `id()`), so there is no process to
spawn and no payload to parse, and each segment reveals its details when the pointer
is over it.

## What it draws

One row, the segments separated by `|` and painted in the chosen scheme:

| Segment | Drawn as | Detail on hover |
| --- | --- | --- |
| git branch | `repo(branch)` from the nearest `.git/HEAD` (worktree `.git` files followed, at most 12 levels up); the directory name when there is no repository | repository, branch, GitHub `owner/name` from the remote, and the cwd |
| model | the display name derived from the model id (`claude-fable-5-1` reads `Fable5.1`), then the effort level once a `turn.step` has carried one | the model id and the effort level |
| context | `used/window` tokens, coloured by the percentage used | the token count and the percentage |
| 5h | percentage of the five-hour window used | the exact percentage and when it resets |
| 7d | percentage of the seven-day window used | the same for the weekly window |
| session | the session id | the id, which is also the transcript file name |
| cost | `$0.00` once the session has cost anything | the cost to four decimals |

A segment whose noun failed is drawn dim as `<id>!` with the error in its detail; a
segment with nothing to show yet (no cost, no rate-limit window) is left out. When
the band is at least two rows high and `details` is on, a second row reads
`hover a segment:` and shows the detail of the segment under the pointer. The bar is
rebuilt after `session.start` and after every `turn.complete`; `turn.step` updates the
effort level; while a survey holds the band the hook passes the band through.

## Options

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `scheme` | `claude-code`, `codex` or `mono` | `claude-code` | The palette. `claude-code` uses the hues the shell version copied from the theme; `mono` paints nothing and dims every segment. |
| `details` | boolean | `true` | Draw the hover-details row. Needs the fullscreen terminal UI with mouse tracking. |
| `pin_status` | boolean | `false` | Also pin the bar as plain text under the prompt through `$.ui.status`, where no hover is needed. |

Run it from a clone with

    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir mods/statusline

If `settings.json` still carries the shell `statusLine` command, both lines draw;
remove that entry to keep one.

## Measured

Claude Code 2.1.278. The mod rows are single observations from one Haiku 4.5 session
on 2026-09-22 with the shell status line off; the shell row is three runs of 30 spawns
of the classic command with a fixed payload on 2026-09-21.

| What | Value |
| --- | --- |
| Bar on screen after the process was spawned | 2.22 s |
| First render after `session.start` | 192.7 ms |
| Cold gather of the nouns, once at start | 260.8 ms (from `ui.render`), 124.8 ms (from `session.start`) |
| Warm gather after a turn | 4.66 ms |
| Render of the band | 2.64 ms the first time, then 0.25 to 0.44 ms |
| Shell version, one `statusLine` spawn | 132.4 ms median of 30, with 122.0 and 137.1 ms in two other runs of 30 (bare `node` spawn 119.4 ms median of 30); paid on every status-line update, asynchronously and off the renderer's path, so not on the same clock as the render row |
| Kit, one run from this repository | first mount 76.8 ms (60.6 to 84.0 across earlier runs), 200 cached renders median 1.6 ms, p90 2.8 ms, max 13.9 ms |

The hover reveal was observed live on the committed build (`ae9bf239`) in the
fullscreen UI on a 40 by 140 pseudo-terminal on 2026-09-22: one Haiku 4.5 session, one
Bash turn so the bar carried all seven segments, then a pointer sweep over every screen
row driven by the estate's `claude_live_probe.py`. Before the sweep the details row
held only its prefix. Sweeping along the bar row changed the details row at columns 1,
7, 17, 25, 33, 39 and 77, each time to the detail of the segment covering that column
(git branch, model, context, 5h, 7d, session, cost); the segments begin at columns 1,
7, 16, 25, 32, 39 and 76 and the sweep stepped two columns from 1, so three of those
hovers landed one column inside their segment. No other row changed the details row:
the six rows of the Bash tool output answered with a redraw by the hidevalues mod,
loaded in the same session, and the remaining 33 rows sent nothing back at any of the
nine columns sampled. With the pointer parked at the top-left corner afterwards no
detail was shown. In the classic scrolling UI (`CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1`,
same day, same sweep) the bar is drawn but Claude Code requests no mouse tracking from
the terminal (only focus events, mode 1004), so no pointer position reaches it and
nothing reveals.

## Limits

- Hover is applied by the terminal surface. No hook runs when the pointer moves, so
  the mod cannot observe or log a reveal, and the kit cannot test one; the kit tests
  check the tree (every segment names a scope, every scope has a hidden row, a
  malformed hover tree is refused).
- The mods API gives the model id only; the display name is derived from it, and an
  id that is not `claude-*` is shown as it came.
- The effort level is unknown until the first `turn.step`. The `/config` rows are
  read once at start in case one carries it; in the measured session none of the 43
  rows did.
- `PROBE_RUN` in the environment makes `turn.complete` write a JSON timing dump, under
  `out/<PROBE_RUN>` unless `PROBE_OUT` names another directory. Both exist for
  measurement and are otherwise inert.
