import type { EngineInterface, On, PluginOptions, RenderChildren } from 'claude-code'

// ClaudeCodeStatusline as a function-hook mod. The classic statusLine command reads a
// JSON payload on stdin and prints one painted line under the prompt; here the same
// segments are built from the session nouns and drawn in the prompt's hint line, the
// row the shell version used. Every segment names a hover scope that reveals its
// details on a card over the row above, and /statusline-mod opens a pane that picks the
// segments, their order and the options. Hover is applied by the surface: no hook
// runs when the pointer moves, so nothing here can observe it.

const COMMAND = 'statusline-mod'
const PANE = 'statusline-mod'
const PREFS = 'statusline.prefs.v1'

type Pal = {
  path?: string
  branch?: string
  github?: string
  label?: string
  model?: string
  session?: string
  cost?: string
  sep?: string
  ok?: string
  mid?: string
  high?: string
}

// Raw colours (a theme key is also accepted). The claude-code hues are the ones the
// original script copied from the theme keys ide, autoAccept, permission, claude,
// inactive, success, subtle, warning and error.
const SCHEMES: Record<string, Pal> = {
  codex: {
    path: 'green',
    branch: 'magenta',
    github: 'magenta',
    label: 'magenta',
    model: '#d77757',
    session: 'white',
    cost: 'green',
    ok: 'green',
    mid: 'yellow',
    high: 'red',
  },
  'claude-code': {
    path: '#4782c8',
    branch: '#af87ff',
    github: '#b1b9f9',
    label: '#b1b9f9',
    model: '#d77757',
    session: '#999999',
    cost: '#4eba65',
    sep: '#505050',
    ok: '#4eba65',
    mid: '#ffc107',
    high: '#ff6b80',
  },
  mono: {},
}

type Entry = { id: string; label: string; about: string }

// Every segment the bar can carry, in the order the pane lists the ones not chosen.
export const REGISTRY: readonly Entry[] = [
  { id: 'git-branch', label: 'git branch', about: 'repo(branch), or the directory name outside a repository' },
  { id: 'directory', label: 'directory', about: 'the name of the current directory' },
  { id: 'branch', label: 'branch', about: 'the branch alone' },
  { id: 'github', label: 'github', about: 'owner/name from the GitHub remote' },
  { id: 'model', label: 'model', about: 'the model name, then the effort level' },
  { id: 'context', label: 'context', about: 'context tokens used of the window' },
  { id: 'five-hour-limit', label: '5h', about: 'the five-hour rate-limit window' },
  { id: 'weekly-limit', label: '7d', about: 'the seven-day rate-limit window' },
  { id: 'session', label: 'session', about: 'the session id' },
  { id: 'cost', label: 'cost', about: 'the session cost in dollars' },
]

export const DEFAULT_IDS: readonly string[] = ['git-branch', 'model', 'context', 'five-hour-limit', 'weekly-limit', 'session', 'cost']

type Piece = { text: string; color?: string }
type Seg = { id: string; pieces: Piece[]; detail: string; failed?: boolean }

type Snap = {
  cwd: string
  repo: string | null
  branch: string | null
  github: string | null
  model: string
  effort: string | number | undefined
  context?: { tokens?: number; window: number; percent?: number }
  five?: { percentUsed: number; resetsAt?: string }
  seven?: { percentUsed: number; resetsAt?: string }
  cost?: number
  session: string
  errors: Record<string, string>
}

type Prefs = { ids: string[] }
type Cfg = { schemeName: string; pal: Pal; mono: boolean; details: boolean; pinStatus: boolean }

let snap: Snap | null = null
let effort: string | number | undefined
let effortSeed: Promise<void> | null = null
let prefs: Prefs | null = null
let interactive = false
let cfg: Cfg = { schemeName: 'claude-code', pal: SCHEMES['claude-code'], mono: false, details: true, pinStatus: false }

// Wall-clock samples of the two costs the classic command pays per update as one
// process spawn: the gather through the session nouns and the render of the line.
// Read back by the PROBE_RUN dump; nothing here is drawn.
type Timing = { started_at?: number; first_render_at?: number; gather_ms: number[]; gather_src: string[]; render_ms: number[]; config_keys?: string[]; config_list_calls: number; effort_seed?: string; effort_seed_error?: string; command_error?: string }
const timing: Timing = { gather_ms: [], gather_src: [], render_ms: [], config_list_calls: 0 }
const now = (): number => (globalThis as any).performance?.now?.() ?? Date.now()
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))
const pluginName = (name: string) => name.split('@')[0]

// The classic payload carries model.display_name; the mods API gives only the id
// ($.session.model(), "as /model shows it"). The name is derived from the id here:
// claude-fable-5-1 -> Fable 5.1, claude-haiku-4-5-20251001 -> Haiku 4.5. A context
// tag is not part of the name: claude-opus-5-5[1m] reads Opus 5.5 (owner, 2026-09-22).
// A value that is not a claude-* id (an alias, or a name already) is shown as it came.
export function displayName(id: string): string {
  const m = /^claude-([a-z]+)((?:-\d{1,3})*)(?:-\d{8})?(?:\[[0-9a-z]+\])?$/.exec(id)
  if (!m) return id
  const family = m[1].charAt(0).toUpperCase() + m[1].slice(1)
  const version = m[2].split('-').filter(Boolean).join('.')
  return version ? family + ' ' + version : family
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 1_000) return Math.round(n / 1_000) + 'K'
  return String(n)
}

function pctColor(pct: number, pal: Pal): string | undefined {
  return pct >= 75 ? pal.high : pct >= 50 ? pal.mid : pal.ok
}

function effortColor(level: string | number, pal: Pal): string | undefined {
  if (typeof level === 'number' && Number.isFinite(level)) return pctColor(level, pal)
  const s = String(level).toLowerCase()
  if (s === 'xhigh' || s === 'max') return pal.high
  if (s === 'medium' || s === 'high') return pal.mid
  if (s === 'low') return pal.ok
  return undefined
}

function baseName(dir: string): string {
  const m = /([^/]+)\/?$/.exec(dir)
  return m ? m[1] : dir
}

function dirName(dir: string): string {
  const parent = dir.replace(/\/[^/]*\/?$/, '')
  return parent === '' ? '/' : parent
}

function resolvePath(base: string, rel: string): string {
  if (rel.startsWith('/')) return rel
  const out: string[] = []
  for (const part of (base + '/' + rel).split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return '/' + out.join('/')
}

// The original's gitInfo: walk up at most 12 levels, read .git/HEAD, and follow a
// worktree's `.git` file (gitdir: ...) to the real HEAD. $.fs.read rejects when the
// path is missing, which is the walk's "keep going" signal.
async function gitInfo($: EngineInterface, startDir: string): Promise<{ repo: string; branch: string } | null> {
  let dir = startDir
  for (let i = 0; i < 12 && dir; i++) {
    const gitPath = dir + '/.git'
    let head: string | null = null
    try {
      head = await $.fs.read(gitPath + '/HEAD')
    } catch {
      head = null
    }
    if (head === null) {
      try {
        const file = await $.fs.read(gitPath)
        const m = /gitdir:\s*(.+)/.exec(file)
        if (m) head = await $.fs.read(resolvePath(dir, m[1].trim()) + '/HEAD')
      } catch {
        head = null
      }
    }
    if (head !== null) {
      const t = head.trim()
      const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(t)
      return { repo: baseName(dir), branch: ref ? ref[1] : t.slice(0, 7) }
    }
    const parent = dirName(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

function githubOf(remote: string | null | undefined): string | null {
  if (!remote) return null
  const m = /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/.exec(remote)
  return m ? m[1] : null
}

// Effort is not on $.session and the first turn.step is the first time it rides an
// event; until then the /config rows are the only place a level could be read from.
// Whether such a row exists is measured, not assumed: the keys go into the dump.
// One successful read per session: the row set does not grow an effort key later.
// Gathers that start while the read is in flight share it; a failed read is retried
// by the next gather, and a level a turn.step brought meanwhile is not overwritten.
function seedEffort($: EngineInterface): Promise<void> {
  if (effort !== undefined) return Promise.resolve()
  if (!effortSeed) {
    effortSeed = readEffortRow($).catch((err) => {
      effortSeed = null
      throw err
    })
  }
  return effortSeed
}

async function readEffortRow($: EngineInterface): Promise<void> {
  const rows = await $.config.list()
  timing.config_list_calls += 1
  if (!timing.config_keys) timing.config_keys = rows.map((row) => row.key)
  const row = rows.find((r) => /effort/i.test(r.key) && (typeof r.value === 'string' || typeof r.value === 'number'))
  if (row && effort === undefined) {
    effort = row.value as string | number
    timing.effort_seed = row.key
  }
}

async function gather($: EngineInterface, src: string): Promise<Snap> {
  const t0 = now()
  try {
    return await gatherNouns($)
  } finally {
    // Pushed on completion, so the arrays are in completion order; src names the caller.
    timing.gather_ms.push(now() - t0)
    timing.gather_src.push(src)
  }
}

async function gatherNouns($: EngineInterface): Promise<Snap> {
  const errors: Record<string, string> = {}
  try {
    await seedEffort($)
  } catch (err) {
    // Not a segment failure: effort still arrives with turn.step. Kept for the dump.
    timing.effort_seed_error = String(err)
  }
  const s: Snap = {
    cwd: '',
    repo: null,
    branch: null,
    github: null,
    model: '?',
    effort,
    session: '',
    errors,
  }
  try {
    s.cwd = await $.session.cwd()
  } catch (err) {
    for (const id of ['git-branch', 'directory']) errors[id] = String(err)
  }
  if (s.cwd) {
    try {
      const git = await gitInfo($, s.cwd)
      if (git) {
        s.repo = git.repo
        s.branch = git.branch
      }
    } catch (err) {
      for (const id of ['git-branch', 'branch']) errors[id] = String(err)
    }
  }
  try {
    const repo = await $.session.repo()
    s.github = githubOf(repo ? repo.remote : null)
  } catch (err) {
    errors['github'] = String(err)
  }
  try {
    s.model = (await $.session.model()) || '?'
  } catch (err) {
    errors['model'] = String(err)
  }
  try {
    const usage = await $.session.usage()
    s.context = usage.context
    for (const win of usage.rateLimits || []) {
      if (win.kind === 'five_hour') s.five = win
      if (win.kind === 'seven_day') s.seven = win
    }
    s.cost = usage.cost ? usage.cost.usd : undefined
  } catch (err) {
    for (const id of ['context', 'five-hour-limit', 'weekly-limit', 'cost']) errors[id] = String(err)
  }
  try {
    s.session = await $.session.id()
  } catch (err) {
    errors['session'] = String(err)
  }
  return s
}

function limitSeg(id: string, label: string, win: Snap['five'], pal: Pal): Seg | null {
  if (!win || !Number.isFinite(win.percentUsed)) return null
  const p = Math.max(0, Math.round(win.percentUsed))
  return {
    id,
    pieces: [{ text: label, color: pal.label }, { text: ' ' }, { text: p + '%', color: pctColor(p, pal) }],
    detail: label + ' window ' + win.percentUsed + '% used, resets ' + (win.resetsAt || 'unknown'),
  }
}

function build(s: Snap, pal: Pal, ids: readonly string[]): Seg[] {
  const segs: Seg[] = []
  const builders: Record<string, () => Seg | null> = {
    'git-branch': () =>
      s.branch
        ? {
            id: 'git-branch',
            pieces: [{ text: s.repo || '', color: pal.path }, { text: '(' + s.branch + ')', color: pal.branch }],
            detail: 'repo ' + s.repo + ', branch ' + s.branch + (s.github ? ', github ' + s.github : '') + ', cwd ' + s.cwd,
          }
        : { id: 'git-branch', pieces: [{ text: baseName(s.cwd), color: pal.path }], detail: 'cwd ' + s.cwd + ', not inside a git repository' },
    directory: () => ({ id: 'directory', pieces: [{ text: baseName(s.cwd), color: pal.path }], detail: 'directory ' + s.cwd }),
    branch: () => (s.branch ? { id: 'branch', pieces: [{ text: s.branch, color: pal.branch }], detail: 'branch ' + s.branch + ' of ' + s.repo } : null),
    github: () => (s.github ? { id: 'github', pieces: [{ text: s.github, color: pal.github }], detail: 'github ' + s.github } : null),
    model: () => {
      const name = displayName(s.model)
      const pieces: Piece[] = [{ text: name.replace(/\s+/g, ''), color: pal.model }]
      const level = s.effort
      if ((typeof level === 'string' && level) || (typeof level === 'number' && Number.isFinite(level))) {
        pieces.push({ text: ' ' }, { text: String(level), color: effortColor(level, pal) })
      }
      return {
        id: 'model',
        pieces,
        detail: 'model ' + s.model + ', effort ' + (level === undefined ? 'unknown until the first turn.step' : String(level)),
      }
    },
    // The classic line shows 0/1M before the first response; usage.context carries the
    // window then and no token count, so an unknown count reads as zero used.
    context: () => {
      const cw = s.context
      if (!cw || !Number.isFinite(cw.window) || cw.window <= 0) return null
      const used = Number.isFinite(cw.tokens as number) ? (cw.tokens as number) : 0
      let pct = cw.percent
      if (!Number.isFinite(pct as number)) pct = (used / cw.window) * 100
      const p = Math.max(0, Math.min(100, Math.round(pct as number)))
      return {
        id: 'context',
        pieces: [{ text: fmtTokens(used) + '/' + fmtTokens(cw.window), color: pctColor(p, pal) }],
        detail: 'context ' + used + ' of ' + cw.window + ' tokens (' + p + '%)',
      }
    },
    'five-hour-limit': () => limitSeg('five-hour-limit', '5h', s.five, pal),
    'weekly-limit': () => limitSeg('weekly-limit', '7d', s.seven, pal),
    session: () =>
      s.session ? { id: 'session', pieces: [{ text: s.session, color: pal.session }], detail: 'session ' + s.session + ' (the transcript file name)' } : null,
    cost: () =>
      typeof s.cost === 'number' && s.cost > 0
        ? { id: 'cost', pieces: [{ text: '$' + s.cost.toFixed(2), color: pal.cost }], detail: 'cost $' + s.cost.toFixed(4) + ' this session' }
        : null,
  }
  for (const id of ids) {
    const builder = builders[id]
    if (!builder) continue
    if (s.errors[id]) {
      segs.push({ id, pieces: [{ text: id + '!' }], detail: id + ' failed: ' + s.errors[id], failed: true })
      continue
    }
    let seg: Seg | null = null
    try {
      seg = builder()
    } catch (err) {
      seg = { id, pieces: [{ text: id + '!' }], detail: id + ' failed: ' + String(err), failed: true }
    }
    if (seg) segs.push(seg)
  }
  return segs
}

function plainBar(segs: Seg[]): string {
  return segs.map((seg) => seg.pieces.map((p) => p.text).join('')).join('|')
}

// Ids kept from the store: known, unique, in the stored order. Anything else in the
// value is dropped; a value that is not a list at all means "the defaults".
function normalizeIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const out: string[] = []
  for (const id of value) if (typeof id === 'string' && REGISTRY.some((r) => r.id === id) && !out.includes(id)) out.push(id)
  return out
}

async function loadPrefs($: EngineInterface): Promise<Prefs> {
  if (prefs) return prefs
  let stored: unknown
  try {
    stored = await $.store.get(PREFS)
  } catch {
    stored = undefined
  }
  const ids = stored && typeof stored === 'object' ? normalizeIds((stored as { ids?: unknown }).ids) : null
  prefs = { ids: ids ?? [...DEFAULT_IDS] }
  return prefs
}

// The chosen segments changed: persist them, redraw, and re-pin the plain copy.
async function applyIds($: EngineInterface, ids: string[]): Promise<void> {
  prefs = { ids }
  await $.store.set(PREFS, prefs)
  $.ui.invalidate('ui.render')
  if (cfg.pinStatus && snap) $.ui.status(plainBar(build(snap, cfg.pal, ids)))
}

async function toggleId($: EngineInterface, id: string): Promise<void> {
  const p = await loadPrefs($)
  await applyIds($, p.ids.includes(id) ? p.ids.filter((x) => x !== id) : [...p.ids, id])
}

async function moveId($: EngineInterface, id: string, delta: number): Promise<void> {
  const p = await loadPrefs($)
  const i = p.ids.indexOf(id)
  const j = i + delta
  if (i < 0 || j < 0 || j >= p.ids.length) return
  const ids = [...p.ids]
  ids.splice(i, 1)
  ids.splice(j, 0, id)
  await applyIds($, ids)
}

// An option lives in the /config row this plugin's userConfig field declares; the row
// is looked up by field name because the key carries the loaded plugin's name, which
// a marketplace install spells differently from a --plugin-dir load.
async function setOption($: EngineInterface, field: string, value: string | boolean): Promise<void> {
  const mine = pluginName($.plugin.name)
  const rows = await $.config.list()
  const row = rows.find((r) => r.provider.plugin !== 'engine' && pluginName(r.provider.plugin) === mine && r.key.endsWith('.' + field))
  if (!row) {
    $.ui.toast('statusline: no /config row for ' + field + ' (the plugin was not loaded through /config)')
    return
  }
  const result = await $.config.set({ key: row.key, value })
  if (result.deny !== undefined) $.ui.toast('statusline: ' + field + ' refused: ' + result.deny)
}

function summary(p: Prefs): string {
  const rest = REGISTRY.map((r) => r.id).filter((id) => !p.ids.includes(id))
  return [
    'Status line: ' + (p.ids.length ? p.ids.join(', ') : 'nothing (every segment is off)'),
    'Scheme ' + cfg.schemeName + ', hover details ' + (cfg.details ? 'on' : 'off') + ', pinned copy ' + (cfg.pinStatus ? 'on' : 'off') + '.',
    rest.length ? 'Not shown: ' + rest.join(', ') + '.' : '',
    'Run /' + COMMAND + ' in an interactive session to change them; `reset` restores the defaults.',
  ]
    .filter(Boolean)
    .join('\n')
}

// The scanner lets `$` travel only into a function declared at the top of the file,
// so the refresh shared by session.start and turn.complete lives here, not in register.
async function refresh($: EngineInterface, src: string): Promise<void> {
  snap = await gather($, src)
  const p = await loadPrefs($)
  $.ui.invalidate('ui.render')
  if (cfg.pinStatus) $.ui.status(plainBar(build(snap, cfg.pal, p.ids)))
}

// Pane presses run one after another; a failure becomes a toast, never a lost pane.
let actions: Promise<unknown> = Promise.resolve()
function act($: EngineInterface, operation: () => Promise<unknown>): void {
  actions = actions.then(operation).catch((error) => {
    $.ui.toast('statusline: ' + errorText(error))
  })
}

function readOptions(options: PluginOptions): Cfg {
  const schemeName = typeof options?.scheme === 'string' && SCHEMES[options.scheme] ? options.scheme : 'claude-code'
  return {
    schemeName,
    pal: SCHEMES[schemeName],
    mono: schemeName === 'mono',
    details: options?.details === undefined ? true : options.details === true,
    pinStatus: options?.pin_status === true,
  }
}

export function register(on: On, options: PluginOptions) {
  cfg = readOptions(options)

  on('session.start', async ($, e, next) => {
    timing.started_at = now()
    interactive = e.isInteractive === true
    const started = await next(e)
    try {
      await $.command.register({ name: COMMAND, description: 'Pick the status line segments, their order and the colour scheme.', argumentHint: '[show | reset]' })
    } catch (err) {
      timing.command_error = String(err)
    }
    await refresh($, 'session.start')
    return started
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    await refresh($, 'turn.complete')
    const run = await $.env.get('PROBE_RUN')
    if (run && snap) {
      const outDir = (await $.env.get('PROBE_OUT')) || 'out/' + run
      const stats = (xs: number[]) => {
        const s = [...xs].sort((a, b) => a - b)
        return xs.length ? { n: xs.length, median: s[Math.floor(s.length / 2)], p90: s.length >= 10 ? s[Math.ceil(s.length * 0.9) - 1] : null, max: s[s.length - 1], all: xs } : { n: 0 }
      }
      const p = await loadPrefs($)
      await $.fs.write(
        outDir + '/statusline.json',
        JSON.stringify({
          snap,
          effort,
          ids: p.ids,
          bar: plainBar(build(snap, cfg.pal, p.ids)),
          scheme: cfg.schemeName,
          details: cfg.details,
          pinStatus: cfg.pinStatus,
          timing: {
            gather: stats(timing.gather_ms),
            render: stats(timing.render_ms),
            gather_src: timing.gather_src,
            config_list_calls: timing.config_list_calls,
            effort_seed_error: timing.effort_seed_error ?? null,
            command_error: timing.command_error ?? null,
            first_render_after_start_ms: timing.started_at !== undefined && timing.first_render_at !== undefined ? timing.first_render_at - timing.started_at : null,
            config_keys: timing.config_keys ?? null,
            effort_seed: timing.effort_seed ?? null,
          },
        }),
      )
    }
    return done
  })

  // Effort is not on $.session; it rides every model request as turn.step's e.effort.
  on('turn.step', async function* ($, e, next) {
    if (e.effort !== undefined && e.effort !== effort) {
      effort = e.effort
      if (snap) snap.effort = effort
    }
    return yield* next(e)
  })

  // The bar, in the hint line under the prompt. Revealing a detail moves nothing: a
  // detail laid out in the row widened the engine's hint line until it wrapped and took
  // the bar from under the pointer (measured on 2.1.280), so details are cards out of
  // the flow, over the row above.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const ids = (await loadPrefs($)).ids
    if (!ids.length) return next(e)
    if (!snap) snap = await gather($, 'ui.render')
    const t0 = now()
    if (timing.first_render_at === undefined) timing.first_render_at = t0
    const segs = build(snap, cfg.pal, ids)
    if (!segs.length) return next(e)
    const { Box, Text } = await $.ui.resolve(e)
    const { pal, mono, details } = cfg

    const bar: RenderChildren[] = []
    segs.forEach((seg, i) => {
      if (i) bar.push(Text({ children: '|', color: pal.sep, dimColor: mono || !pal.sep, wrap: 'truncate' }))
      const scope = 'sl-' + seg.id
      for (const piece of seg.pieces) {
        bar.push(
          Text({
            children: piece.text,
            color: mono ? undefined : piece.color,
            dimColor: mono || seg.failed,
            wrap: 'truncate',
            hover: { scope, bold: true, underline: true },
          }),
        )
      }
    })
    const children: RenderChildren[] = [Box({ flexDirection: 'row', flexShrink: 0, children: bar })]
    const hint = typeof e.props.hint === 'string' ? e.props.hint.trim() : ''
    if (hint) children.push(Box({ flexShrink: 1, children: [Text({ children: '  ' + hint, dimColor: true, wrap: 'truncate' })] }))

    if (details) {
      for (const seg of segs) {
        children.push(
          Box({
            position: 'absolute',
            top: -1,
            left: 0,
            display: 'none',
            hover: { scope: 'sl-' + seg.id, display: 'flex' },
            children: [Text({ children: ' ' + seg.detail + ' ', wrap: 'truncate' })],
          }),
        )
      }
    }

    const tree = Box({ flexDirection: 'row', children })
    timing.render_ms.push(now() - t0)
    return tree
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'reset') {
      await applyIds($, [...DEFAULT_IDS])
      return { text: 'Status line reset to ' + DEFAULT_IDS.join(', ') + '.' }
    }
    if (arg === 'show' || (arg === '' && !interactive)) return { text: summary(await loadPrefs($)) }
    if (arg !== '') return { text: 'Usage: /' + COMMAND + ' [show | reset]' }
    await $.ui.open({ id: PANE, title: 'Status line', focus: true, closeOnEscape: true, holdToasts: true, rows: 20 })
    return {}
  })

  // The pane: a preview of the bar, a row per segment (a digit toggles it, the arrows
  // move it while it is on), then the options, which write the plugin's own /config
  // rows so the engine reloads the module with them.
  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    const elements = await $.ui.resolve(e)
    const { Box, Text, Button } = elements
    const p = await loadPrefs($)
    if (!snap) snap = await gather($, 'ui.render')
    const { pal, mono, details, pinStatus, schemeName } = cfg
    const segs = build(snap, pal, p.ids)

    const preview: RenderChildren[] = [Text({ children: 'Preview  ', dimColor: true })]
    segs.forEach((seg, i) => {
      if (i) preview.push(Text({ children: '|', color: pal.sep, dimColor: mono || !pal.sep }))
      for (const piece of seg.pieces) preview.push(Text({ children: piece.text, color: mono ? undefined : piece.color, dimColor: mono || seg.failed }))
    })
    if (!segs.length) preview.push(Text({ children: '(nothing to draw)', dimColor: true }))

    const children: RenderChildren[] = [
      Box({ flexDirection: 'row', children: preview }),
      Text({ children: 'Segments: a digit toggles one, ▲ ▼ move it; the line under the prompt follows at once.', dimColor: true }),
    ]
    const order = [...p.ids, ...REGISTRY.map((r) => r.id).filter((id) => !p.ids.includes(id))]
    order.forEach((id, i) => {
      const entry = REGISTRY.find((r) => r.id === id)
      if (!entry) return
      const chosen = p.ids.includes(id)
      const row: RenderChildren[] = [
        Button({
          key: 'toggle:' + id,
          label: (chosen ? '[x] ' : '[ ] ') + entry.label,
          ...(i < 9 ? { hotkey: String(i + 1) } : {}),
          plain: true,
          onPress: () => act($, () => toggleId($, id)),
        }),
      ]
      if (chosen) {
        row.push(
          Text({ children: ' ' }),
          Button({ key: 'up:' + id, label: '▲', plain: true, dimColor: true, onPress: () => act($, () => moveId($, id, -1)) }),
          Text({ children: ' ' }),
          Button({ key: 'down:' + id, label: '▼', plain: true, dimColor: true, onPress: () => act($, () => moveId($, id, 1)) }),
        )
      }
      row.push(Text({ children: '  ' + entry.about, dimColor: true }))
      children.push(Box({ flexDirection: 'row', children: row }))
    })

    children.push(Text({ children: ' ' }))
    const schemes = Object.keys(SCHEMES)
    if (e.surface !== 'mobile' && 'Select' in elements) {
      children.push(
        elements.Select({
          key: 'scheme',
          label: 'Scheme ',
          options: schemes.map((value) => ({ value, label: value })),
          value: schemeName,
          onSelect: (value) => act($, () => setOption($, 'scheme', value)),
        }),
      )
    } else {
      const following = schemes[(schemes.indexOf(schemeName) + 1) % schemes.length]
      children.push(Button({ key: 'scheme', label: 'Scheme: ' + schemeName, hotkey: 's', onPress: () => act($, () => setOption($, 'scheme', following)) }))
    }
    children.push(
      Button({ key: 'details', label: (details ? '[x] ' : '[ ] ') + 'Reveal a segment’s details under the pointer', hotkey: 'h', plain: true, onPress: () => act($, () => setOption($, 'details', !details)) }),
      Button({ key: 'pin', label: (pinStatus ? '[x] ' : '[ ] ') + 'Also pin a plain copy of the bar', hotkey: 'p', plain: true, onPress: () => act($, () => setOption($, 'pin_status', !pinStatus)) }),
      Text({ children: 'The options are /config rows: changing one reloads the mod with the new value.', dimColor: true }),
      Text({ children: ' ' }),
      Box({
        flexDirection: 'row',
        gap: 2,
        children: [
          Button({ key: 'reset', label: 'Reset segments', hotkey: 'r', onPress: () => act($, () => applyIds($, [...DEFAULT_IDS])) }),
          Button({ key: 'close', label: 'Close', hotkey: 'q', onPress: () => act($, () => $.ui.close({ id: PANE })) }),
        ],
      }),
    )
    return Box({ flexDirection: 'column', children })
  })
}
