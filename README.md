# ClaudeCodeMods

Mods for Claude Code by konsta95: plugins written as function hooks, the TypeScript
modules Claude Code loads into its own process when function hooks are enabled. Each
mod is a complete plugin under `mods/`, and the repository is a plugin marketplace
listing all of them.

| Mod | What it does | Verified |
| --- | --- | --- |
| [`statusline`](mods/statusline) | The [ClaudeCodeStatusline](https://github.com/konsta95/ClaudeCodeStatusline) bar as a function hook: drawn in the band above the prompt from the session's own nouns, each segment revealing its details on hover. | kit 11 of 11, strict typecheck clean, bar and hover observed live |
| [`hidevalues`](mods/hidevalues) | Hides high-entropy tokens and e-mail addresses in Bash tool rows until the pointer is over them. | kit 7 of 7, strict typecheck clean, hide and reveal observed live |
| [`mod-settings`](mods/mod-settings) | `/mods`: a pane listing every mod's declared settings, with drafts, presets, reset and undo. | kit 35 of 35, strict typecheck clean, Apply and Undo observed live once; open limits in its README |

## Requirements

- Claude Code 2.1.278, the version the mods were written and measured against.
  Function hooks are early access and their API may change between releases without
  notice; a later version may refuse or break a module.
- Function hooks enabled: `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` in the environment of
  the `claude` process. Without it no hooks module is loaded.
- Hover needs the fullscreen terminal UI (`"tui": "fullscreen"` in `settings.json`)
  with mouse tracking; under tmux the server needs `mouse on`. Everything else works
  in the classic scrolling UI.

## Running a mod

From a clone, load one mod for a single session:

    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir mods/statusline

Or add the clone as a marketplace and install the mods you want. This was checked on
2026-09-22 with a directory source, all three mods installing and listing as enabled:

    claude plugin marketplace add /path/to/ClaudeCodeMods
    claude plugin install statusline@ClaudeCodeMods
    claude plugin install hidevalues@ClaudeCodeMods
    claude plugin install mod-settings@ClaudeCodeMods

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
(the scopes, the hidden rows, and that a malformed hover tree is refused). The reveal
itself was observed in live sessions, as each mod's README records.

## Licence

MIT, see [LICENSE](LICENSE).
