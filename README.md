# ClaudeCodeMods

Mods for Claude Code by konsta95: plugins written as function hooks, the TypeScript
modules Claude Code loads into its own process when function hooks are enabled. Each
mod is a complete plugin under `mods/`, and the repository is a plugin marketplace
listing all of them.

| Mod | What it does | Verified |
| --- | --- | --- |
| [`statusline`](mods/statusline) | The [ClaudeCodeStatusline](https://github.com/konsta95/ClaudeCodeStatusline) bar as a function hook: drawn in the hint line under the prompt, where the shell version drew, from the session's own nouns; each segment reveals its details on hover, and `/statusline-mod` opens a picker in the band above the prompt that picks the segments, their order and the options. | kit 40 of 40, strict typecheck clean, hover, model switch, context updates and the picker observed live on 2.1.280 as its README records |
| [`hidevalues`](mods/hidevalues) | Hides high-entropy tokens and e-mail addresses in Bash tool rows until the pointer is over them. | kit 7 of 7, strict typecheck clean, hide and reveal observed live on 2.1.278; in the classic UI the hide draws and nothing reveals |
| [`mod-settings`](mods/mod-settings) | `/mods`: a pane listing the mods' visible settings, with drafts, presets, reset and undo; in `/config` it labels the mods' rows `ClaudeCodeMods: <title>`. | kit 40 of 40, strict typecheck clean, Apply and Undo observed live on 2.1.278 in two probe sessions, the `/config` labels and the pane observed live on 2.1.280; open limits in its README |

## Requirements

- Claude Code 2.1.280, the version the mods were last verified against: the kits,
  `claude plugin validate` and the typecheck for all three, and the hover live for
  `statusline`. The mods were written against 2.1.278. Function hooks are early access
  and their API may change between releases without notice: in 2.1.280
  `$.model.complete` began resolving a result object instead of a string, which broke
  the pane of `mod-settings` 0.2.0 once Explain was pressed. A later version may refuse
  or break a module.
- Function hooks enabled: `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` in the environment of
  the `claude` process. Without it no hooks module is loaded.
- Hover needs the fullscreen terminal UI (`"tui": "fullscreen"` in `settings.json`)
  with mouse tracking; under tmux the pane needs `mouse on` (read from
  `tmux show -g mouse`; the probes wrote mouse reports straight into the session, so
  none exercised tmux's own mouse handling). Both mods draw in the classic scrolling UI
  too (sessions on 2026-09-22 with `CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1`: the
  `statusline` bar and the `hidevalues` hide were drawn), but that UI requests no mouse
  tracking from the terminal, only focus events, so nothing reveals there.

## Running a mod

From a clone, load one mod for a single session:

    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir mods/statusline

Or add the repository as a marketplace and install the mods you want. Checked on
2026-09-22 from GitHub at commit 334509e and from a local clone as a directory source,
all three mods installing and listing as enabled:

    claude plugin marketplace add konsta95/ClaudeCodeMods
    claude plugin install statusline@ClaudeCodeMods
    claude plugin install hidevalues@ClaudeCodeMods
    claude plugin install mod-settings@ClaudeCodeMods

A local clone works the same way with its path in place of `konsta95/ClaudeCodeMods`.

Each mod declares its options under `userConfig` in its manifest. Set them with
`/plugin configure <mod>@ClaudeCodeMods`, with `--config KEY=VALUE` on install, or
from the `/mods` pane once `mod-settings` is loaded.

## Verifying

Every mod carries its tests under `tests/`, run by Claude Code's plugin kit from the
mod's directory:

    cd mods/statusline
    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test

`claude plugin validate mods/<name>` checks the manifest and lists the module's hooks
and engine calls. The modules typecheck under `tsc --strict` against the `claude-code`
declarations Claude Code writes with `/plugin-types`. Those declarations are
Anthropic's and are not part of this repository, so the command names them:

    tsc --strict --noEmit --target ES2022 --module ESNext --moduleResolution bundler \
      --skipLibCheck /path/to/claude-code.d.ts hooks/*.ts tests/*.ts

The kit cannot move a pointer, so a hover test in it checks the tree the hook returns
(the scopes, the hidden elements a hover reveals, and that a malformed hover tree is
refused). The reveal
itself was observed in live sessions, as each mod's README records.

## Licence

MIT, see [LICENSE](LICENSE).
