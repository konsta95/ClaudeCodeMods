# statusline

[ClaudeCodeStatusline](https://github.com/konsta95/ClaudeCodeStatusline) as a
function-hook mod. The shell version is a `statusLine` command that Claude Code spawns
after every response, feeding it a JSON payload on stdin and printing the line it
returns under the prompt. This version runs inside the process: a `ui.render` hook on
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

Single observations on Claude Code 2.1.278, 2026-09-21 and 2026-09-22, a Haiku 4.5
session with the shell status line off.

| What | Value |
| --- | --- |
| Bar on screen after the process was spawned | 2.22 s |
| First render after `session.start` | 192.7 ms |
| Cold gather of the nouns, once at start | 260.8 ms (from `ui.render`), 124.8 ms (from `session.start`) |
| Warm gather after a turn | 4.66 ms |
| Render of the band | 2.64 ms the first time, then 0.25 to 0.44 ms |
| Shell version, one `statusLine` spawn | 132.4 ms median of 30 (bare `node` spawn 119.4 ms median of 30), paid after every response |
| Kit, one run from this repository | first mount 76.8 ms, 200 cached renders median 1.6 ms, p90 2.8 ms |

The hover reveal was observed live in the fullscreen UI on a 40 by 140 pseudo-terminal:
before the sweep the details row held only its prefix, and sweeping the pointer along
the bar showed each segment's detail in turn, and nothing over a separator or past the
bar's end.

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
- `PROBE_RUN` and `PROBE_OUT` in the environment make `turn.complete` write a JSON
  timing dump. They exist for measurement and are otherwise inert.
