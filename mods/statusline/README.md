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
| model | yes | the display name derived from the model id with its spaces removed, as the shell version prints it (`claude-opus-5-5[1m]` reads `Opus5.5`), then the effort level once a main-loop `turn.step` has carried one | the model id and the effort level |
| context | yes | `used/window` tokens, coloured by the percentage used | the token count and the percentage |
| 5h | yes | percentage of the five-hour window used | the exact percentage and when it resets |
| 7d | yes | percentage of the seven-day window used | the same for the weekly window |
| session | yes | the session id | the id, which is also the transcript file name |
| cost | yes | `$0.00` once the session has cost anything | the cost to four decimals |

A segment whose noun failed is drawn dim as `<id>!` with the error in its detail; a
segment with nothing to show yet (no cost, no rate-limit window) is left out. With
every segment off, the hint line is passed through unchanged and the pinned copy
is cleared. Turning `pin_status` off also clears a copy left by the prior activation.

With `details` on, hovering a segment shows its detail on a one-row card over the row
above the bar, which in the fullscreen UI is the prompt box's bottom rule, starting at
the bar's first column. The card is placed out of the layout, so showing it moves
nothing on screen.

The bar is rebuilt after `session.start`, as every model request of the main loop
goes out (`turn.step`, while the request is in flight, so the request waits for
nothing), after every `turn.complete`, after `/model`, `/compact`, `/clear`, and
after a command-triggered resume passes the identity and retry-window checks below,
after a completed main-session compaction, and after the model row of `/config` is
written. While retention is suppressed, hint and open-picker draws read usage again:
this includes the post-compaction wait and uncertainty after a failed initial
context-store read. The timing source `ui.render.compacted` names both cases. The
first hint or picker draw also gathers session state if no
snapshot exists. Once each main-loop response has
arrived, the bar reads usage again before the response's tools run, so
the context the response was answered over, the rate limits and the cost show while
those tools run. A model switch shows at the latest from the first
request after it. A subagent's request changes nothing on the bar: it names its own
model and effort, not the session's. Rebuilds overlap, and one that finishes after a
newer one is dropped.

Whenever the engine omits a context count and the bar remembers one for this session,
it keeps that count through later refreshes, including the next request. A new
reported count replaces the remembered count.
A change of context window keeps the count and recomputes the percentage for that
window. A failed session-id read still learns and retains reported counts in memory,
alongside `session!` when that segment is enabled; usage errors still draw `context!`.
Those new counts are saved only after the same previously verified session id returns.
A different id discards them. With no previously verified id, they remain display-only
while the id is unavailable and are discarded when an id first verifies, even if
usage still omits its count. The bar then uses that session's saved state or a newly
reported count; without either it shows `0/window`.

A completed main-session `session.compact` event discards the remembered count and
prevents remembering another until a subsequent response arrives. During that wait,
each draw of the hint or picker preview uses the engine's reported count, or
`0/window` when it omits one. A component that has not redrawn can still display its
pre-compaction count until its own next draw or a refresh, as described under Limits.
The engine can also still report its old count when `/compact` returns. The
waiting state survives a module reload when its marker was saved successfully. A
compaction after the tracked session ends waits for the next verified session id
before saving that session's marker. An earlier wait already bound to another
session does not transfer across an unrelated session switch. Skipped compaction,
precomputation that installs nothing, and a subagent's compaction
do not reset the main bar. The built-in `/clear` and a change of session also discard
the remembered count. A plugin that answers `/clear` without running the built-in
command leaves retention intact.

Rewinding messages within the current session remains a known limit in 0.3.4: the
remembered count survives both slash-command and double-Esc rewind. If the engine omits its count after restoring the conversation,
the bar can therefore show the count from before rewind. Rewind reset is deferred
until a supported signal or a verified detector covers every required case.
The message picker's **Summarize from here** and **Summarize up to here** also leave
the remembered count intact. On 2.1.280 both bypass `session.compact`; their classic
PostCompact event does not provide a verified main-session discriminator. A native
subagent compaction emitted that event without an agent id and with the main
session's transcript path. These actions can therefore leave the pre-summary count
on the bar when usage omits its count.

The remembered count is saved under the session's id in the plugin store and restored
after a module reload, including an option change. Another session ignores it. Store
writes are best effort and drawing does not wait for them. A failed save is retried
on a later refresh, even when the count has not changed; a reload before a successful
save can restore an older count. If the initial store read fails, the mod cannot know
whether it holds a compaction marker. It shows reported usage without remembering
it until a later successful read or a new response establishes retention. During
that uncertainty, an omitted count can therefore display as zero.

Binary inspection of Claude Code 2.1.282's resume body shows the destination id
switching before transcript replacement, with awaited work between them.
Pending-resume reads wait while a command is running. When a command raised a
resume end and that resume is still pending, its return checks the destination id.
If the identity checks pass, it rebuilds the bar and can finish the resume only after
a fresh read reports a count for the destination; an omitted count or usage error
keeps it pending. An early command return cannot rearm the ended session while a
different destination is still unbound.

A pending resume checks every 100 ms for up to five seconds after the end hook's
cleanup wait, so a later menu selection can refresh without another keystroke.
Menu resumes continue retrying through that interval even after reading a new id
and numeric count. The expiry bounds retries; it does not prove that the transcript
is ready. Expiry ends the pending resume entirely: subsequent cached hint and band
draws do not retry it. A transcript swap outside that interval waits for the next
ordinary refresh, such as a model request. Another session end or start also ends
the pending resume. The render hooks match only those two components,
so bar invalidations do not redraw transcript or tool rows through this mod.

This covers the observed `/resume`, `/branch` and rewind menu's **resume previous
session** paths. A resume can end and continue the same id without `session.start`;
its completed command rearms context retention for that id only when a classic
start names that id or `/resume` receives exactly that id as its argument. No new model request is
needed for the refreshed bar. This previous-session action is separate from rewinding
messages within the current session, whose retention limit is described above.

If saving a compaction marker fails, the mod tries to delete the obsolete saved
count and retries the marker on later refreshes. Deletion alone cannot preserve the
waiting state across reload: without a saved marker, a reload can learn a lingering
engine count again. If deletion also fails, a reload can restore the discarded count.
No persistence guarantee is possible while those store operations keep failing.

The `session.end` hook forwards the chain promptly, queues deletion once after prior
writes, and limits its wait for cleanup to part of the remaining shared end budget.
The supplied 2.1.280 contract fires that hook on exit, `/clear`, resume, logout, a signal
and the end of a `-p` run, with a default overall cleanup deadline of 1.5 seconds. If
no end event runs, cleanup is interrupted or outlasts the wait, or deletion fails,
that key can remain in the shared plugin store. This mod has no background collection
of abandoned session keys.

## /statusline-mod

In an interactive session `/statusline-mod` opens a picker in the band directly above
the prompt, across its full width, where Claude Code draws its own surveys: a preview
of the bar, a row per segment, the chosen ones first in their order and then the rest,
and the options. The line under the prompt follows every change at once.

| Key | Pressed in | Does |
| --- | --- | --- |
| `1` to `0` | the empty prompt or the band | toggles the segment on that row |
| ctrl+x tab | the prompt | gives the band the keys, with the focus on the first row |
| ↑ ↓ | the band | walk the rows and the options, wrapping at either end |
| Enter | the band | presses the row or option in focus |
| `u` `d` | the band | move the segment that last had the focus up or down |
| `s` `h` `p` | the band | the next scheme, hover details on or off, the pinned copy on or off |
| `r` | the band | resets the segments |
| `q` | the band | closes the picker |
| Esc | the band | gives the keys back to the prompt and leaves the picker open |

A toggled segment moves to the end of the chosen ones or back among the rest, and `u`,
`d` and reset move rows too; through each of these the focus stays on the segment it
was on. With the focus on Move up or Move down, Enter moves the same segment again. The
picker closes with `q` or when a prompt is sent, stays open through the module reloads
an option change causes, and is not drawn in another session. In a band too short for
a row per segment the segments are laid out in a grid without their descriptions, and
the footer is drawn while it fits.

The chosen segments and their order are kept in the plugin's store and persist across
sessions. The options are the plugin's own `/config` rows: the picker writes them, and
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

Claude Code 2.1.280, 2026-09-22. The live mod rows come from three sessions, each on
Opus 5.5 in a 140 by 40 tmux pane with one short turn: two in the fullscreen UI and one
in the classic UI. The shell row is three runs of 30 spawns of the classic command
with a fixed payload on 2026-09-21.

| What | Value |
| --- | --- |
| Bar on screen after the process was spawned | 2.0 to 2.6 s (the screen was read every 0.5 s) |
| First render after `session.start` | 183 to 508 ms |
| Cold gather of the nouns, twice at start | 120 to 318 ms |
| Warm gather after a turn | 16 to 42 ms |
| Usage read once a response has arrived | 0.53 and 0.73 ms, against 31.2 and 28.4 ms for the whole gathers as the same two requests went out (one Haiku 4.5 probe session) |
| Render of the hint line | median 0.47 ms, 0.21 to 11.13 ms, across 21 renders |
| Shell version, one `statusLine` spawn | 132.4 ms median of 30, with 122.0 and 137.1 ms in two other runs of 30 (bare `node` spawn 119.4 ms median of 30); paid on every status-line update, asynchronously and off the renderer's path, so not on the same clock as the render row |
| Kit on 2.1.281, 0.3.3 hook `53e8e221…`, one run on 2026-09-24 | first mount 186.31 ms, 200 cached renders median 1.650 ms, p90 2.527 ms, max 11.535 ms; no usage reads during those cached renders |

The kit timing uses an empty, working in-memory store. Its regression check requires
the first mount to read usage and the cached draws not to read it again. Without
that store fixture, the failed initial context read leaves retention suppressed:
the same check observed 200 usage reads during 200 draws and failed. The timing
figures describe this run; the test asserts the cached path, not a speed threshold.

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

The model switch was measured on 2026-09-22 in four Haiku 4.5 sessions in a 140 by 40
pty, driven by `claude_live_probe`, two on this build and two on 0.2.0. After
`/model sonnet` this build redrew the bar as `Sonnet5`, where 0.2.0 redrew it as
`Haiku4.5`. In a turn of two model requests, a file read and then the answer, this
build redrew the context as `37K/200K` after the read and before the answer, where 0.2.0
kept `0/200K` until the turn ended.

The context during a response's tools, `/clear` and `/compact` were measured the same
day in eight more such sessions, four on this build and four on 0.2.1. In a turn whose
first response ran `sleep 20`, this build showed `42K/200K` and the cost for the whole
sleep, where 0.2.1 showed `0/200K` until the next request went out. On forks of that
conversation, `/clear` made this build show `0/200K` and the new session id, where 0.2.1
kept `42K/200K` and the old id. In those `/compact` screen samples, both builds displayed
`42K/200K`. This build showed the cost growing from $0.09 to $0.10; 0.2.1 kept $0.09.
Those samples do not establish the count reported after the compacted transcript was
installed.

The picker was driven on 2026-09-22 in Haiku 4.5 sessions on a 280 by 69 pty, the
owner's fullscreen layout, recording after each key the cells drawn inverted, which is
where the focus is. There the pane of 0.2.2 docked beside the transcript, and once its
Scheme select had the focus, ↓ cycled the schemes and the two options after it were
never reached. In the band, ↓ walked the ten rows and the seven options and wrapped.
`u`, `u`, `d`, `d` moved the context segment and the focus stayed on it at each new
row, as it did through a toggle off and back on, a digit toggling another row, and a
reset. A digit typed into the empty prompt toggled its row, and the next key typed
reached the prompt. `q` closed the picker, and so did sending a prompt. On a 100 by 30
pty the band drew the grid with the footer, and the digits and the focus worked the
same.

Two engine behaviours shaped the picker (2.1.280). After a module reload the engine
asked for the band twice before the first draw was done; in 11 of 15 runs that reloaded
the module, every press on the band was dropped afterwards while the focus still moved.
The mod finishes the band's draws in the order they began, and presses then survived
the reload in 5 of 5 such runs and in all four reloads of the final runs. And the focus
keeps its place in the band rather than its element: a plugin's `$.ui.focus` lands on
the element where the band shows it before the redraw a press asked for, so the mod
draws the segment the focus was on under a key no drawing had yet, which the engine
waits for (13 ms in a probe), and the focus lands on the redrawn row.

The line under the prompt was recorded frame by frame on 2026-09-22 and 2026-09-23, in
Haiku 4.5 sessions on a 280 by 69 pty whose output was replayed through a terminal
emulator. At the observed hint changes and many redraws the plugin asked for, Claude
Code 2.1.280 drew one frame with the engine's own hint row
with the bar drawn last on the row below it, pushing the prompt up a row, before the new
answer puts the bar back beside the pill: a copy of the bar one row down, for one frame.
In a turn of six tool calls, a session with no hook on the line drew no such frame in two
runs, and a hook drawing fixed text that never asked for a redraw drew one at each change
of the engine's hint, among them the first key typed into the empty prompt during a
streamed turn. 0.3.0 asked for a redraw after every refresh, two per model request, and
the six-tool turn drew 16, 8 of them with nothing on the bar changed. Version 0.3.1 began
comparing the bar and its hover details before asking for a redraw: the same turn drew
7 in a copy carrying the change and 9 on 0.3.1. The 2 in the second changed no cell of
the bar, and without the mod's redraws that turn drew none mid-turn, so by elimination
they were a hover card's figures,
the exact tokens or the cost to four places. Typing during a streamed turn drew 6 on 0.3.0
and 5 on 0.3.1: three at hint changes, one at a figure's change, and one at the
turn's end with the bar unchanged, which the fixed-text hook drew too.
The recordings also contain bar-changing redraws with no split frame, so a plugin
redraw does not invariably cause one.

The context after an interrupted turn was measured on 2026-09-23 in the same kind of
Haiku 4.5 sessions, with every read the mod made traced. In recording U1, the engine
answered `$.session.usage()` with the window and no token count, 41 ms after the read at
the step's end had 37,105. That recording kept only the names of the turn-completion
fields. Recording V1 separately captured `isAborted: true` and `reason: 'aborted'`,
followed by a usage result with the window and no count. The typings describe a missing
count as a fresh or just-compacted window. In two further classic-statusline runs,
`W-shell-1` and `W-shell-2`, the last nonzero payloads reported 39,448 and 39,523 input
tokens; the following payloads reported zero input tokens and zero percent used.
The classic row showed `0/200K` after Esc and during the next request, then recovered
after its response. The earlier payload-only recording ended with 37,191 input
tokens; it did not establish continued retention or render the classic bar.
Versions 0.3.0 and 0.3.1 drew the missing count as `0/200K` after interruption, in
6 of 6 interrupted runs (three each) and none of 6 finished ones. Version 0.3.2 kept
the figure during the interrupted turn's completion refresh: the next interrupted run
kept `37K/200K`
until the next prompt, as did a run left to finish. Later refreshes could still erase
it: after Esc then a new prompt, a screen read showed `0/200K` before the response
supplied a new figure. Version 0.3.3 retains the last reported count across those
refreshes, as described above.

Before store persistence was added, an earlier 0.3.3 candidate was checked on
2026-09-23 in further Haiku 4.5 sessions on the same
280 by 69 terminal. In the Esc-then-prompt run, the sampled screens showed `39K/200K`
after the explicit interruption and while the next request was in flight, then
`40K/200K` with its response. These are screen checkpoints, not a claim about every
intermediate frame. With `pin_status` enabled at startup, the separate plain row was
present before the first prompt, and both copies updated after the response. That
run's startup gather finished before the hint draws; the kit covers the opposite
order and an effort change drawn while a refresh is still gathering.
In a separate Esc-then-`/compact` run, the bar retained `39K/200K` after Esc,
showed `0/200K` after completed manual compaction, and showed `38K/200K` after the
next response. The trace recorded `session.compact` before the command's refresh.
An earlier attempt was canceled during compaction and is not evidence of a completed
reset.

An earlier 0.3.3 candidate, SHA256
`0a51219eb4ebdff493928fa004aaa136fff036ef76736cab342080e201b247bc`,
was checked on 2026-09-23 in two Haiku 4.5 sessions with separate scratch config
directories. In the Esc-then-prompt run, the engine reported 32,510 tokens with the
first response and 32,629 before omitting the count at the interrupted completion.
The sampled screens kept `33K/200K` after Esc and during the next request; its
response reported 33,176 tokens. The rounded labels alone do not establish which
exact retained number was displayed.
In the compaction run, `33K/200K` was visible before `/compact`; when the command
hook returned, usage still reported 32,509 tokens. The recording shows `33K/200K`
after the completed notice, then zero. At the subsequent interruption, two traced
hint draws reported 31,233 tokens and the recording briefly showed `31K/200K`, then
zero again. The sampled screen during the next request showed zero; its response
reported 31,599 and the bar showed `32K/200K`. Both runs
used that same hook hash, checked again afterwards. These checkpoints establish the
sampled states, not every intermediate frame. Another candidate kept its cached
`33K/200K` after installation even when the engine omitted the count. The current hook
shares ordered usage across the hint, picker preview and pinned copy while waiting
for a post-compaction response, so an older usage sample cannot replace a newer one.
This orders the data used by each draw; it does not make the hint and preview redraw
together. Either component can lag a draw of the other until its own next draw or a
refresh, as described under Limits.

Both scenarios were repeated on the revision-3 candidate, SHA-256
`ad974275fdcb9ddb5428ef7c5c467a920e84c08e86c538c9c50875108557d659`, on 2026-09-23.
After Esc, the sampled bar retained `33K/200K` while usage omitted its count, including
at the next request; that response reported 33,071. The separate compaction run began
with `33K/200K` on screen. The recording showed `33K/200K` just after `Compacted`, then
zero. Around the subsequent interruption, the engine reported 31,263 and the recording
briefly showed `31K/200K`, then zero again. The sampled next request showed zero and
its response reported 31,607, displayed as `32K/200K`. These observations permit the
engine's transient numeric reports; they do not establish continuous zero after
compaction. Both runs used scratch configuration directories. Afterwards, the hook
hash, owner's settings and all files in the owner's plugin-store tree matched their
pre-run contents.

The final revision-4 hook, SHA-256
`82f11acd80aefd654681a7fd6619c4109b67ef09c84db86f7a16e24931715719`, was checked with
both scenarios again that day. Esc and the next request showed `33K/200K` while the
API omitted its count; the next response reported 33,105. The compaction run began
at `33K/200K`. Its command-return trace still had the original transcript and 32,512
tokens; the first trace with the installed summary omitted the count. The recording
showed `Compacted`, a brief `33K/200K`, then zero. The subsequent interrupted request
reported 31,314 and briefly drew `31K/200K`, followed by zero after Esc and during
the next request. That response reported 31,747 and drew `32K/200K`. Both runs used
scratch configuration directories; the hook hash was unchanged afterwards. The
owner's settings and both statusline store contents matched the pre-run snapshots.
The separate installed mod-settings store changed during that window, so the whole
plugin-store comparison did not pass.

The revision-5 hook, SHA-256
`9f22d8e60e41dcd5f013ae4ef2fe9c4cee41adb2626ed92e4136a55a8d776fe2`, was checked with
both scenarios on 2026-09-23 in scratch configuration directories. Esc and the next
request retained `33K/200K` while usage omitted its count; the next response reported
33,125 tokens. In the compaction run, the command-return trace still reported
32,507 tokens before summary installation. After installation usage omitted its
count. The interrupted request reported 31,308 transiently; after Esc and during
the next request the sampled bar showed zero. The next response reported 31,746
and displayed `32K/200K`. These samples do not establish continuous zero after
compaction.

Both message-picker Summarize options were also observed live that day. Each fired
classic PreCompact and PostCompact with trigger `manual`, without `session.compact`,
and retained the session id. PostCompact still read the original count; after the
summary was installed usage omitted tokens. An ordinary subagent's completed
automatic compaction emitted classic PostCompact without `agent_id` or `agent_type`,
using the main session id and transcript path. The typed identity contract therefore
did not supply a reliable main-only discriminator in this build; both Summarize
options remain documented limits.

Rewind was investigated on 2026-09-23 with a scratch observer. `/rewind` returned
before picker selection; double Esc opened the picker without a `command.run` event.
Canceling either picker preserved the transcript and count. Successful restoration
removed the selected prompt, kept the same session ID and could leave usage without
a token count. `/checkpoint` and `/undo` also opened the picker and reached the
command hook as `rewind`. A prototype detected ordinary rewinds through the user-turn
count, but that detector was excluded from 0.3.3 because it could miss a decrease
after failed reads or on transcript rows the count omits. A numeric zero was not
observed from this build's usage API; numeric-zero unit cases test a hypothetical input.

On Claude Code 2.1.281, the revision-7 hook
`9e09675895b566d36a653b7fc396f616a311e64b595a43274569047fd6ceaa1d`
repeated both native runs on 2026-09-23. The Esc run showed `33K/200K` after the
interruption and through the next request. In this run the engine continued to
report 32,677 tokens at those checkpoints; the next response reported 33,006.
This run therefore did not exercise an omitted count after Esc.

The separate compact run still reported 32,558 tokens when `/compact` returned.
After summary installation the engine omitted its count and the bar showed
`0/200K`. The interrupted request then reported 31,408 tokens, and the sampled bar
showed `31K/200K` after Esc and during the next request. The next response reported
31,706 and displayed `32K/200K`. Reported numeric usage is displayed during the
wait; these observations do not establish continuous zero after compaction.
Both runs used scratch configuration directories. The hook hash, owner's
`settings.json` and plugin-store contents matched their pre-run snapshots.

The revision-8 hook, SHA-256
`53e8e221417cf2f5cfb91d7280351d1463b4cd7695f1362f05015b47778588c6`, repeated both
runs on 2.1.281 on 2026-09-24 in scratch configuration directories. The Esc run
reported 32,689 tokens at the interrupted completion and showed `33K/200K` after
Esc and during the next request. Its next response reported 33,000. This run did
not exercise an omitted count after Esc.

The separate compact run still reported 32,557 tokens when the command returned.
After summary installation usage omitted its count and the sampled bar showed
`0/200K`. The interrupted request then reported 31,302 tokens; after Esc and during
the next request the sampled bar showed `31K/200K`. The next response reported
31,597 and displayed `32K/200K`. These samples do not establish continuous zero
after compaction. Both runs used the same hook hash, verified again afterwards.

Separate Haiku traces recorded on 2026-09-24 compared ordinary Esc interruptions
across the two builds, with six runs per build. On 2.1.280,
`$.session.usage().context.tokens` was absent at the aborted turn's completion and
the next request's first step in all six runs. On 2.1.281 it was present at both
points in all six runs. Each run's terminal recording identifies its build; the
2.1.280 runs used a cached binary. The revision-7 and revision-8 Esc runs above
also observed a reported count on 2.1.281.

The 0.3.3 hook, `53e8e221…`, was checked live on 2.1.281, not 2.1.280. The newest
hook run live on 2.1.280 was `9f22d8e6…`, on 2026-09-23. Handling of omitted counts
is checked by the kit, as described under Regression checks.
Separate engine-only Haiku checks on 2026-09-24 sampled a second interrupt,
`/model haiku`, `/config model=haiku`, a subagent completion, module reload and
conversation rewind after an interruption. Each path had three completed 2.1.281
runs; all sampled post-seed reads carried a count. One 2.1.280 control per path
omitted counts after the interruption; rewind restored a count, while the other
paths kept omitting it until a new main response. Cold startup omitted counts on
both builds. These checks loaded only the observer, not statusline, and do not
establish every model or history. Rewind remains the documented retention limit.

The 2.1.281 live compaction runs above show omitted counts after summary
installation and the hint changing to zero. Those runs did not open the picker.
In the kit, each component that draws during the wait uses zero for an omitted
count or displays the reported count. The component that has not redrawn can still
show its pre-compaction count until its own next draw or a refresh; see Limits.

### 0.3.4 pin cleanup and resume

On 2026-09-24, scratch Haiku sessions on 2.1.281 compared the 0.3.3 hook
`53e8e221417cf2f5cfb91d7280351d1463b4cd7695f1362f05015b47778588c6`
with the first 0.3.4 candidate
`21fa1baf37792f97f8b2b5536c5c487c103a5f2d10b173143d59c31d5c413f53`.
With 0.3.3, disabling `pin_status` through `/config` reloaded the module but left
the previous pinned row visible. Disabling every segment pinned an empty string,
leaving a visible `⚠ statusline:` row. With that candidate, both actions called
`ui.status(undefined)` and removed the row.

Direct `/resume`, same-id `/resume`, and the resume picker emitted `session.end`
without another `session.start`. The 0.3.3 bar continued naming the ended session.
The first candidate's direct and same-id resumes showed the resumed id and `7K/200K` before
another model request; the engine reported 6,843 tokens. Picker resume also
refreshed the selected session before a request. These live checks cover 2.1.281;
0.3.4 was not run live on 2.1.280.

The round-2 hook is
`356b736f8b96e074997b05b02e1eabb282b5589a72e5fb92c2757dcdc9d4f6cf`.
Before that change, two scratch Haiku sessions on 2.1.281 observed `/branch` and
the rewind menu's **resume previous session** emit `session.end` with reason
`resume`. The first candidate kept the ended session's id and `0/200K` while
the engine reported 6,705 tokens for the destination. The rewind command returned
before selection. Its classic SessionStart event named the destination before
the session-id noun had switched, so that event alone was too early to refresh.

With the round-2 hook, a scratch 2.1.281 Haiku session showed the destination id
and `7K/200K` in both rows after `/branch`, same-id `/resume` and cross-id `/resume`.
The sampled engine count was 6,777. Previous-session selection still left both rows
on the ended id and `0/200K` until another keystroke. The earlier reported successful
screen for that path was captured after typing a sample command.

The round-3 hook is
`4e579ec267ede514bd780615eba6d881b3db2a27fefa09b77c56d06cbc69e9c8`.
In a scratch 2.1.281 Haiku session, the screen captured after previous-session
selection and before any further input showed the destination and `7K/200K` in both
rows. The trace recorded the destination's pinned update 172 ms after Enter; this
is one observed interval, not a latency guarantee. The engine reported 6,774 tokens.
Branch, same-id resume and cross-id resume also showed their destinations before
further input, and pin-off with selected segments removed the pinned row.
The all-segments-off and resume-picker live checks above used the first candidate;
the round-3 hook covered pin cleanup in the kit. The round-3 hook was not run live
on 2.1.280.

The round-4 hook is
`bece985a0b592b6964fcdf35f3b0dff898dd35f83dfe36066434de044659d960`.
It was checked on 2.1.282 after the installed engine updated during the round.
In a scratch Haiku session, `/resume` from a cleared session and the rewind menu's
**resume previous session** each showed the destination and `7K/200K` in both rows
before any further keystroke. The engine reported 7,312 tokens. These captures
show the completed transitions; the mock-clock cases below deliberately place
reads between the id change and transcript replacement. The live frequency of
that mixed-read window remains unmeasured.

The round-5 hook is
`1c1af6377165e6d240049e6c549d573ad0759dbafcba4467d86a98e217bfb570`.
On 2026-09-25, a scratch Haiku session on 2.1.282 again showed the destination and
`7K/200K` in both rows before further input after direct resume and previous-session
menu selection. The destination reported 6,779 tokens. A further menu selection
started from a session reporting 6,816 tokens and returned to that destination:
the menu path is reachable from a counted session. These live captures establish
the completed transitions; the wrong intermediate count/store write remains kit
evidence, as described under Limits.

Effort behavior is unchanged from 0.3.3. The Haiku checks supplied no
`turn.step.effort`; the `--effort high` launch used the 0.3.3 hook `53e8e221…`.
Those sessions do not establish effort behavior on an effort-capable model.

## Regression checks

Version 0.3.4 passes 127 default kit tests, thirteen pinned-copy fixtures and one
details-off fixture on 2.1.282, plus validation and strict typechecks against
the 2.1.280, 2.1.281 and 2.1.282 declarations. The 97 unchanged default tests from 0.3.3
also pass against this hook on 2.1.282. In the earlier 2.1.281 checks,
the selected-segment pin-off, direct resume and
same-id retention cases fail on the 0.3.3 hook. The branch cases for hint and pin
also fail on the first 0.3.4 candidate. Previous-session hint and pin cases now
inject no render after binding; both fail on the round-2 hook and pass here.
A bar-change case redraws none of its 30 transcript rows across three requests;
it fails on round 2, which redraws them 90 times. A defensive case for a command
returning before its destination binds fails on round 2 and passes here; that
ordering was not observed live. Mock-clock checks on 2.1.282 cover polling expiry,
idle behavior, and menu retries after a numeric count. After clear/other ends,
the checks assert no further session-id reads; those cases alone do not establish
that a timer was running before that end. Three
compatibility cases for effort across clear, same-id resume and cross-id resume
pass on 0.3.3, fail on the first candidate and pass on this hook. They preserve
0.3.3 behavior; they do not establish the engine's effort setting. Tests use the
kit clock rather than waiting on real timers.

On 2.1.282, the shipped W1, W2 and W2b mixed-read cases fail on the round-3 hook
and pass on round 4: menu usage arrives after the first destination-id tick;
command usage arrives after a tick inside the command; and the destination store
receives the post-command count. The numeric-old-count menu case also fails on
round 3 and passes here. Atomic-switch, transcript-before-tick, and late-binding
controls pass on both. Missing/error count cases keep retrying after command
completion, a reported zero can finish the resume, and expiry bounds polling even
if no destination count arrives. The pinned fixtures check both rows and retention
through the next omitted count for menu and command transitions.

Round 5 adds cached hint and band checks at expiry for menu and command resumes,
with reported and omitted destination counts. On 2.1.282, the menu cases and the
command-without-count case fail on the round-4 hook and pass on round 5: later
cached draws make no usage or id reads. The next model request still refreshes
normally. The independent Owner and review read-count probes agree. The menu
misattribution probes B/B2 remain failing evidence for the limit below; they are
not counted as passing regressions. The late-swap probe C remains the accepted
limit of the retry window.

The declarations were exported with native `/plugin-types` on each named version;
the 2.1.282 export was regenerated during this round. All three exports are strict
typecheck inputs. The declarations describe `PromptHint` and `AbovePrompt` on desktop;
the live checks here cover the terminal.

On 2.1.282, the current hook's kit tests retain an omitted count after an interrupt,
`/model`, a change to the `/config` model row, a subagent completion and a second
interrupt. A separate test loads a fresh module with a saved count to check the
restoration used after reload. These tests establish how
the mod handles supplied omitted counts, including the input observed after Esc
on 2.1.280; they do not establish when the engine supplies those inputs.

Run the default kit and strict typecheck as described in the root README, including
`tests/fixtures/*.ts` in the typecheck. The kit has no per-test plugin options. The
pin and details-off cases are separate source fixtures, run against scratch copies
of the shipped hooks with only the manifest defaults changed. From this directory:

```sh
check_dir=$(mktemp -d)
mkdir -p "$check_dir/pinned/.claude-plugin" "$check_dir/pinned/tests"
cp -R hooks "$check_dir/pinned/hooks"
jq '.userConfig.pin_status.default = true' .claude-plugin/plugin.json > "$check_dir/pinned/.claude-plugin/plugin.json"
cp tests/fixtures/options-world.ts "$check_dir/pinned/tests/"
cp tests/fixtures/pinned.ts "$check_dir/pinned/tests/pinned.test.ts"
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test "$check_dir/pinned"

mkdir -p "$check_dir/details-off/.claude-plugin" "$check_dir/details-off/tests"
cp -R hooks "$check_dir/details-off/hooks"
jq '.userConfig.details.default = false' .claude-plugin/plugin.json > "$check_dir/details-off/.claude-plugin/plugin.json"
cp tests/fixtures/options-world.ts "$check_dir/details-off/tests/"
cp tests/fixtures/details-off.ts "$check_dir/details-off/tests/details-off.test.ts"
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test "$check_dir/details-off"
```

## Limits

- Every pending-resume retry, including one triggered by a draw, ends at the
  five-second expiry after end-hook cleanup. If transcript installation takes
  longer, the bar keeps its last sampled count until an ordinary refresh. Cached
  hint and band draws do not restart the retry window.
- A menu resume can expose and save the ended session's count under the destination
  id if a read lands between the id switch and transcript replacement. If the
  destination subsequently omits its count, that remembered value can persist.
  The kit reproduces both the retained wrong count and an early wrong store write
  later corrected by a reported destination count. An id and numeric count do not
  establish transcript identity: the destination can legitimately have the same
  count. No supported transcript-ready discriminator has been verified for this
  path, and this limit has not been proved unavoidable. The host refused an
  attempted message-list diagnostic because the production hook does not call
  that API; reading the transcript file was not tried. The 2.1.282 live check
  above confirms that previous-session selection can start with a reported count.
  The classic start notice precedes replacement in the inspected 2.1.282
  binary. Its optional context total includes output tokens, unlike the usage
  count displayed here, so it is not an interchangeable destination count. The
  live frequency of the mixed read is unknown.
- While retention is suppressed (the post-compaction wait, or after a failed
  initial context-store read), an engine-requested hint draw can show newer usage
  while the open picker preview still shows the figures it last drew (including its
  pre-compaction count if it has not drawn since compaction). The preview
  catches up on its own next draw or a refresh. A hint-only draw does not itself
  request a preview redraw.
- The reverse also occurs while retention is suppressed: a picker-only draw can
  show newer usage in the preview and, with `pin_status` enabled, the pinned copy,
  while the hint line keeps the figures it last drew (including its pre-compaction
  count if it has not drawn since compaction) until its own next draw or a refresh.
  The band draw does not itself request a hint redraw.
- Hover is applied by the terminal surface. No hook runs when the pointer moves, so
  the mod cannot observe or log a reveal, and the kit cannot test one; the kit tests
  check the tree (every segment names a scope, each scope has a card placed out of
  the layout over the row above, a malformed hover tree is refused).
- A card is one row. Claude Code clips an absolutely placed box at the edge of its
  region, so a detail longer than the room from the bar's first column to the right
  edge of the terminal is cut off there.
- The mods API gives the model id only; the display name is derived from it, and an
  id that is not `claude-*` is shown as it came.
- Effort retains the 0.3.3 behavior: a learned level stays in module memory across
  `/clear` and `/resume`, and a request that omits effort leaves that level intact.
  A module reload loses it; it stays unknown until a main `turn.step` supplies a
  level or a configuration row seeds one. There is no saved effort level in the
  plugin store. The recorded 2.1.281 Haiku configuration dumps contained no effort
  row; this observation does not cover other models.
- After `/compact` the engine can still report the previous response's count
  (observed on 2.1.280), which a new hint or preview draw shows as reported. Once
  compaction completes, a draw with no reported count uses zero instead of the
  discarded remembered count. The other component can still display the count it
  last drew (its pre-compaction count if it has not drawn since compaction) until
  it draws or a refresh arrives, as above. The types
  describe the count as the status line's own `total_input_tokens`.
- Rewinding messages within the current session does not reset the remembered context count in 0.3.4. The supplied API has
  no rewind-completed event or public transcript revision, and the attempted
  user-turn-count detector did not establish complete coverage. Canceling a picker
  also leaves retention unchanged.
- The message picker's **Summarize from here** and **Summarize up to here** do not
  reset retention either; their classic compaction event lacks a verified main-only
  identity signal in the observed build.
- A compaction run while the plugin is disabled is missed. Re-enabling can restore
  the saved pre-compaction count when usage omits its count, until a new response
  supplies another count.
- If the session-id read fails from module load, its saved context state takes
  precedence when the id first returns. In kit probes, a saved 37K replaced the
  52K shown during the failure once usage omitted its count. A saved compaction
  marker also suppressed retention of a completed 21K response received before
  identity recovered: the next interrupted request showed `0/200K` and the marker
  remained saved. A subsequent response with verified identity can establish
  retention again. This remains a limit in 0.3.4.
- A switch made in the `/model` picker was not observed live, because the probe types
  one line and cannot pick an entry. If `command.run` resolves before the pick, the bar
  keeps the old model until the next model request redraws it.
- `PROBE_RUN` in the environment makes `turn.complete` write a JSON timing dump, under
  `out/<PROBE_RUN>` unless `PROBE_OUT` names another directory. Both exist for
  measurement and are otherwise inert.
- The picker and hint line were verified on the terminal. The 2.1.281 declarations
  also name desktop support for both sites; desktop behavior was not tested.
- A plugin cannot give the band the keys (2.1.280 answers `that site does not hold the
  keyboard`), so the picker opens with the keys in the prompt: the digits work from
  there, the arrows and Enter after ctrl+x tab, as the picker's footer says.
- While the picker is open, a digit typed first into the empty prompt toggles a row,
  as a survey's digits do. The picker closes once a prompt is sent.
- The rows are re-sorted after a toggle, the chosen segments first, so after one a
  digit may name another segment.
- The kit has no implementation of a plugin's own `$.ui.focus` (2.1.280: the call
  throws, and the test's `on('ui.focus')` never sees it). The kit checks that the
  segment is drawn under a new key; the focus landing on it was observed live.
- The typings say a tree taller than the band scrolls and arms no digit. At 100
  columns the grid needs six rows, eight with the footer, and a shorter band scrolls it.
- The recorded hint changes still showed the copy of the bar one row down for a
  frame: the first key typed into the empty prompt during a turn, sending a prompt, and
  the turn's end. A fixed-text hook reproduced it without requesting redraws. The
  engine behavior is reported on the mods feedback thread,
  https://github.com/anthropics/claude-code/issues/91870#issuecomment-5790602695.
- With details enabled, a change to a hover card's figures alone can request a redraw
  to keep the card current, and expose that frame. With details disabled, refresh
  deduplication compares the visible segments. Picker actions and the engine can
  still cause draws; this is not a promise that every redraw changes a visible cell.
