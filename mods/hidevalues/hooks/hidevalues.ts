import type { On, PluginOptions, RenderElement } from 'claude-code'

// Detection policy of the case studies: a run of 20 or more token characters whose
// Shannon entropy is at least 4.0 bits per character (video 08), and anything shaped
// like an e-mail address (video 09). Both thresholds are plugin policy, not engine facts.
const CANDIDATE = /[A-Za-z0-9+/_=.-]{20,}/g
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g

export function entropy(s: string): number {
  const counts: Map<string, number> = new Map()
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1)
  let h = 0
  for (const n of counts.values()) {
    const p = n / s.length
    h -= p * Math.log2(p)
  }
  return h
}

export type Span = { text: string; hidden: boolean }

/** Splits one line into plain and hidden spans; overlapping hits merge. */
export function spans(line: string, minLen: number, minEntropy: number, emails: boolean): Span[] {
  const hits: Array<[number, number]> = []
  for (const m of line.matchAll(CANDIDATE)) {
    const at = m.index ?? 0
    if (m[0].length >= minLen && entropy(m[0]) >= minEntropy) hits.push([at, at + m[0].length])
  }
  if (emails) {
    for (const m of line.matchAll(EMAIL)) {
      const at = m.index ?? 0
      hits.push([at, at + m[0].length])
    }
  }
  hits.sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = []
  for (const h of hits) {
    const last = merged[merged.length - 1]
    if (last && h[0] <= last[1]) last[1] = Math.max(last[1], h[1])
    else merged.push([h[0], h[1]])
  }
  const out: Span[] = []
  let pos = 0
  for (const [a, b] of merged) {
    if (a > pos) out.push({ text: line.slice(pos, a), hidden: false })
    out.push({ text: line.slice(a, b), hidden: true })
    pos = b
  }
  if (pos < line.length) out.push({ text: line.slice(pos), hidden: false })
  return out
}

type Ctor = (props: Record<string, unknown>) => RenderElement
type Block = { label: string; lines: Span[][] }
type Found = { blocks: Block[]; count: number }
type Style = { hide: string; reveal: string }
type Output = { stdout?: unknown; stderr?: unknown }
type Row = {
  tool: string
  input?: unknown
  output?: unknown
  isErrored: boolean
  isRunning?: boolean
  isInterrupted?: boolean
}

function parse(text: string, minLen: number, minEntropy: number, emails: boolean): Span[][] {
  const lines = text.split('\n')
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines.map((l) => spans(l, minLen, minEntropy, emails))
}

/** Scans a Bash result's stdout and stderr; count is the number of hidden spans. */
export function scan(out: Output, minLen: number, minEntropy: number, emails: boolean): Found {
  const blocks: Block[] = []
  let count = 0
  for (const label of ['stdout', 'stderr'] as const) {
    const text = out[label]
    if (typeof text !== 'string' || text === '') continue
    const lines = parse(text, minLen, minEntropy, emails)
    count += lines.reduce((a, r) => a + r.filter((s) => s.hidden).length, 0)
    blocks.push({ label, lines })
  }
  return { blocks, count }
}

function commandOf(input: unknown): string {
  const c = input && typeof input === 'object' ? (input as { command?: unknown }).command : undefined
  return typeof c === 'string' ? c : ''
}

// Measured live (2.1.278, terminal): a Bash call's result is drawn by its ToolUse row
// inside an expanded ToolGroup; ToolResult was not raised for it. A ToolUse rewrite
// changes the row alone, header included, so the header is drawn here too. The
// engine's own drawing comes back from next(e) as an opaque engine reference, not a
// Box/Text tree, so the row is redrawn from the result text. Each hidden value is
// its own Text beside its plain neighbours in a row Box: a Text nested in a Text
// follows its group but cannot heat it, so siblings it is.
function draw(Box: Ctor, Text: Ctor, rid: string, header: string | null, found: Found, style: Style) {
  const rows: unknown[] = []
  const tail = rid.slice(-12)
  if (header !== null) rows.push(Text({ children: header }))
  let first = header !== null
  for (const block of found.blocks) {
    block.lines.forEach((line, i) => {
      const lead = header === null ? '' : first ? '  ⎿  ' : '     '
      first = false
      const children: unknown[] = []
      if (lead !== '') children.push(Text({ children: lead, dimColor: true }))
      if (line.length === 0) children.push(Text({ children: ' ' }))
      line.forEach((s, j) => {
        children.push(
          s.hidden
            ? Text({
                children: s.text,
                color: style.hide,
                backgroundColor: style.hide,
                hover: {
                  scope: 'hv-' + tail + '-' + block.label + '-' + i + '-' + j,
                  color: style.reveal,
                  backgroundColor: style.hide,
                  underline: true,
                },
              })
            : Text({ children: s.text, dimColor: block.label === 'stderr' }),
        )
      })
      rows.push(Box({ flexDirection: 'row', children }))
    })
  }
  const note = found.count + ' hidden value' + (found.count === 1 ? '' : 's') + ', hover one to reveal it'
  const footer: unknown[] = []
  if (header !== null) footer.push(Text({ children: '     ', dimColor: true }))
  footer.push(Text({ children: note, dimColor: true }))
  rows.push(Box({ flexDirection: 'row', children: footer }))
  return Box({ flexDirection: 'column', children: rows })
}

export function register(on: On, options: PluginOptions) {
  const minLen = Number(options.min_length ?? 20) || 20
  const minEntropy = Number(options.min_entropy ?? 4) || 4
  const emails = options.emails !== false
  const style: Style = {
    hide: String(options.hide_color ?? '#3a3a3a'),
    reveal: String(options.reveal_color ?? '#ffd700'),
  }

  on('ui.render', { component: ['ToolUse', 'ToolResult'] }, async ($, e, next) => {
    const row = e.props as Row
    const out = row.output as Output | null | undefined
    const pass =
      row.tool !== 'Bash' || row.isErrored || row.isRunning === true || row.isInterrupted === true || !out || typeof out !== 'object'
    const found: Found = pass ? { blocks: [], count: 0 } : scan(out as Output, minLen, minEntropy, emails)

    // Under the probe, record what the engine hands back for this row and what was
    // found, so the real shape of a tool row is measured rather than assumed. The
    // engine's handle is recorded by type and keys only, and a failure in the
    // recording is written as such rather than costing the row.
    const probeOut = await $.env.get('PROBE_OUT')
    if (probeOut) {
      let engine: RenderElement | undefined
      try {
        engine = await next(e)
        const shape = engine && typeof engine === 'object' ? { type: (engine as { type?: unknown }).type, keys: Object.keys(engine) } : engine
        const dump = { surface: e.surface, component: e.component, requestId: e.requestId, viewport: e.viewport, props: e.props, engine: shape, count: found.count }
        await $.fs.write(probeOut + '/toolrow-' + e.component + '-' + e.requestId + '.txt', JSON.stringify(dump, null, 1))
      } catch (err) {
        await $.fs.write(probeOut + '/toolrow-' + e.component + '-' + e.requestId + '.err.txt', String(err))
      }
      if (found.count === 0) return engine ?? next(e)
    } else if (found.count === 0) {
      return next(e)
    }

    const { Box, Text } = await $.ui.resolve(e)
    const header = e.component === 'ToolUse' ? '● ' + row.tool + '(' + commandOf(row.input) + ')' : null
    return draw(Box as Ctor, Text as Ctor, e.requestId, header, found, style)
  })
}
