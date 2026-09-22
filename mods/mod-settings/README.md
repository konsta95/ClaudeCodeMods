# Mod settings

Review and edit settings exposed by Claude Mods. The pane groups settings by their provider and any groups declared by the provider. Engine settings are excluded.

Run `/mods` to open the pane and print the current settings table. Editing a control creates a draft. **Apply draft** writes the changed fields; a rejected field keeps its draft and the engine's reason. Escape or **Discard draft and close** discards the draft.

**Apply preset** and **Reset to declared defaults** write immediately. They can partially succeed if the engine rejects some fields. **Undo last change** restores the last recorded field, provided it still has the value written by that change. For this mod's writes, undo records the value listed immediately before the write and the engine's written result. For other writers, it uses the engine's `config.set.previous` input. Denials and unchanged values add no history.

`/mods <mod>` offers that mod's declared presets. `/mods set <key>=<value>` writes the given field directly and returns any denial verbatim. In print mode, `/mods` and `/mods <mod>` return text without opening a pane or asking a question.

Boolean controls toggle; choice controls use a selector on terminal and cycle on mobile. Text and number controls use an input on terminal and a question with free-text entry on mobile. **Explain** requests a model explanation using the setting and the provider's README only when pressed.

The preview shows observed plugin admissions and recent dispatch summaries. Traces are captured only while the pane is open; closed-pane dispatches do not read or write trace storage. Individual settings do not declare their corresponding events in the engine schema, so the pane explicitly labels that gap and displays the provider's observed events instead.

## Provider metadata

The optional `hooks/settings.json` file, falling back to `settings.json` at the plugin root, can declare groups, risk text and presets. Keys can be local field names or full setting keys. Presets and defaults are checked against the provider's visible rows before writing.

```json
{
  "groups": { "Display": ["show_descriptions"] },
  "risk": { "show_descriptions": "Changes the help text shown in this pane." },
  "presets": {
    "Detailed": { "show_descriptions": true },
    "Compact": { "show_descriptions": false }
  }
}
```

Reset reads defaults from `userConfig` in `.claude-plugin/plugin.json`, falling back to `plugin.json`. Metadata is available for this mod and providers whose registration this mod observed. A provider loaded outside that observation may still have visible settings, while its defaults and presets remain unavailable.

This mod's `show_descriptions` setting controls author-provided help beneath each field. Drafts, undo history and observation state use the engine's plugin store. Drafts and observations reset for a new session; recorded undo history survives.

## Running and testing

    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir mods/mod-settings

Run the kit from this directory with `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test`. `tests/fixtures/guardmark` is a small provider plugin the pane tests load beside this mod (a hook that refuses a marked command, with two declared options and two presets); `benchmarks/no-trace` is an empty plugin kept for a baseline arm the kit does not run: its copy of the trace-cost test is parked as `tests/trace-cost.test.ts.txt`, so `claude plugin test` reports two files. Neither is meant to be installed.

## Authoring status

This mod was written in a Codex round under the owner's session in September 2026 and is published as delivered, with its tests and fixtures. Verified from this repository on 2026-09-22 against Claude Code 2.1.278: `claude plugin test` 35 of 35 across two files, `claude plugin validate` clean, strict `tsc` clean. The kit's trace-cost test measured, per kit dispatch, a median of 0.28 to 0.35 ms (p90 0.38 to 0.47 ms) with the pane closed and 0.76 to 0.90 ms (p90 0.98 to 1.14 ms) with it open, 240 dispatches each, across five runs on one machine. These are gross figures: the baseline arm that would net out the kit's own cost was not run.

Observed live on 2.1.278: in two probe sessions the pane opened from `/mods`, an Apply of a toggle wrote the value and Undo restored it; in four runs with the `statusline` and `hidevalues` mods loaded beside this one, `/mods set statusline.details=false` answered in 0.53 to 0.62 s and the status bar's details row disappeared and came back about 0.5 s later, and the pane listed the other two mods' eight options in three of the four.

Open limits:

- The first-seen toast, shown when a provider is observed for the first time, is unreachable in the kit: the `ADMISSION_REACH` line in the kit output records that the inline replay does not include the mod under test. It has not been observed live either.
- In the run where the pane listed no options, the first load of a fresh configuration, the cause was not isolated.
- During the first of the two Apply and Undo probes the settings file's checksum changed across the pair. The keys that changed (`effortLevel`, `autoCompactWindow`, `dialogExpiry`, `timeFormat`, `verbose`, `enableArtifact`, `alwaysThinkingEnabled`) are engine settings this mod does not write, and the writer was not attributed. The second probe restored the toggle with the checksum unchanged.
- When this mod loads after a provider, that provider's rows are visible but its defaults and presets are not: Reset reports `declared defaults not observed`.
