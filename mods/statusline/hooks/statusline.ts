import type { On, PluginOptions, RenderChildren } from 'claude-code'

// ClaudeCodeStatusline as a function-hook mod. The classic statusLine command reads a
// JSON payload on stdin and prints one painted line; here the same segments are built
// from the session nouns and drawn in the band above the prompt, and every segment
// names a hover scope that reveals its details row. Hover is applied by the surface:
// no hook runs when the pointer moves, so nothing here can observe it.

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

const DEFAULT_IDS = ['git-branch', 'model', 'context', 'five-hour-limit', 'weekly-limit', 'session', 'cost']

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

let snap: Snap | null = null
let effort: string | number | undefined
let effortSeedDone = false

// Wall-clock samples of the two costs the classic command pays per update as one
// process spawn: the gather through the session nouns and the render of the band.
// Read back by the PROBE_RUN dump; nothing here is drawn.
type Timing = { started_at?: number; first_render_at?: number; gather_ms: number[]; gather_src: string[]; render_ms: number[]; config_keys?: string[]; config_list_calls: number; effort_seed?: string; effort_seed_error?: string }
const timing: Timing = { gather_ms: [], gather_src: [], render_ms: [], config_list_calls: 0 }
const now = (): number => (globalThis as any).performance?.now?.() ?? Date.now()

// The classic payload carries model.display_name; the mods API gives only the id
// ($.session.model(), "as /model shows it"). The name is derived from the id here:
// claude-fable-5-1 -> Fable 5.1, claude-haiku-4-5-20251001 -> Haiku 4.5. A value
// that is not a claude-* id (an alias, or a name already) is shown as it came.
export function displayName(id: string): string {
  const m = /^claude-([a-z]+)((?:-\d{1,3})*)(?:-\d{8})?$/.exec(id)
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
async function gitInfo($: any, startDir: string): Promise<{ repo: string; branch: string } | null> {
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
        const file: string = await $.fs.read(gitPath)
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

function githubOf(remote: string | null): string | null {
  if (!remote) return null
  const m = /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/.exec(remote)
  return m ? m[1] : null
}

// Effort is not on $.session and the first turn.step is the first time it rides an
// event; until then the /config rows are the only place a level could be read from.
// Whether such a row exists is measured, not assumed: the keys go into the dump.
async function seedEffort($: any): Promise<void> {
  if (effort !== undefined || effortSeedDone) return
  const rows: Array<{ key: string; value: unknown }> = await $.config.list()
  // One successful read per session: the row set does not grow an effort key later.
  effortSeedDone = true
  timing.config_list_calls += 1
  if (!timing.config_keys) timing.config_keys = rows.map((row) => row.key)
  const row = rows.find((r) => /effort/i.test(r.key) && (typeof r.value === 'string' || typeof r.value === 'number'))
  if (row) {
    effort = row.value as string | number
    timing.effort_seed = row.key
  }
}

async function gather($: any, src: string): Promise<Snap> {
  const t0 = now()
  try {
    return await gatherNouns($)
  } finally {
    // Pushed on completion, so the arrays are in completion order; src names the caller.
    timing.gather_ms.push(now() - t0)
    timing.gather_src.push(src)
  }
}

async function gatherNouns($: any): Promise<Snap> {
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
    errors['git-branch'] = String(err)
  }
  if (s.cwd) {
    try {
      const git = await gitInfo($, s.cwd)
      if (git) {
        s.repo = git.repo
        s.branch = git.branch
      }
    } catch (err) {
      errors['git-branch'] = String(err)
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

function build(s: Snap, pal: Pal): Seg[] {
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
  for (const id of DEFAULT_IDS) {
    if (s.errors[id]) {
      segs.push({ id, pieces: [{ text: id + '!' }], detail: id + ' failed: ' + s.errors[id], failed: true })
      continue
    }
    let seg: Seg | null = null
    try {
      seg = builders[id]()
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

export function marker(id: string): string {
  return '<<sl:' + id + '>>'
}

// The scanner lets `$` travel only into a function declared at the top of the file,
// so the refresh shared by session.start and turn.complete lives here, not in register.
async function refresh($: any, pal: Pal, pinStatus: boolean, src: string) {
  snap = await gather($, src)
  const segs = build(snap, pal)
  await $.ui.invalidate('ui.render')
  if (pinStatus) await $.ui.status(plainBar(segs))
}

export function register(on: On, options: PluginOptions) {
  const schemeName = typeof options?.scheme === 'string' && SCHEMES[options.scheme] ? options.scheme : 'claude-code'
  const pal = SCHEMES[schemeName]
  const mono = schemeName === 'mono'
  const details = options?.details === undefined ? true : options.details === true
  const pinStatus = options?.pin_status === true

  on('session.start', async ($, e, next) => {
    timing.started_at = now()
    const started = await next(e)
    await refresh($, pal, pinStatus, 'session.start')
    return started
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    await refresh($, pal, pinStatus, 'turn.complete')
    const run = await $.env.get('PROBE_RUN')
    if (run && snap) {
      const outDir = (await $.env.get('PROBE_OUT')) || 'out/' + run
      const stats = (xs: number[]) => {
        const s = [...xs].sort((a, b) => a - b)
        return xs.length ? { n: xs.length, median: s[Math.floor(s.length / 2)], p90: s.length >= 10 ? s[Math.ceil(s.length * 0.9) - 1] : null, max: s[s.length - 1], all: xs } : { n: 0 }
      }
      await $.fs.write(
        outDir + '/statusline.json',
        JSON.stringify({
          snap,
          effort,
          bar: plainBar(build(snap, pal)),
          scheme: schemeName,
          details,
          pinStatus,
          timing: {
            gather: stats(timing.gather_ms),
            render: stats(timing.render_ms),
            gather_src: timing.gather_src,
            config_list_calls: timing.config_list_calls,
            effort_seed_error: timing.effort_seed_error ?? null,
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

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    if (!snap) snap = await gather($, 'ui.render')
    const t0 = now()
    if (timing.first_render_at === undefined) timing.first_render_at = t0
    const segs = build(snap, pal)
    const { Box, Text } = await $.ui.resolve(e)

    const bar: RenderChildren[] = []
    segs.forEach((seg, i) => {
      if (i) bar.push(Text({ children: '|', color: pal.sep, dimColor: mono || !pal.sep }))
      const scope = 'sl-' + seg.id
      for (const piece of seg.pieces) {
        bar.push(
          Text({
            children: piece.text,
            color: mono ? undefined : piece.color,
            dimColor: mono || seg.failed,
            hover: { scope, bold: true, underline: true },
          }),
        )
      }
    })

    const rows: RenderChildren[] = [Box({ flexDirection: 'row', children: bar })]

    if (details && e.props.maxRows >= 2) {
      const hidden = segs.map((seg) =>
        Box({
          display: 'none',
          hover: { scope: 'sl-' + seg.id, display: 'flex' },
          children: [Text({ children: marker(seg.id) + ' ' + seg.detail, dimColor: true })],
        }),
      )
      rows.push(
        Box({
          flexDirection: 'row',
          children: [Text({ children: 'hover a segment: ', dimColor: true }), ...hidden],
        }),
      )
    }

    const tree = Box({ flexDirection: 'column', children: rows })
    timing.render_ms.push(now() - t0)
    return tree
  })
}
