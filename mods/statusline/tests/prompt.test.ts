import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const HINT = { isDraft: false, isWorking: false, hint: '? for shortcuts' }
const VIEWPORT = { columns: 140, rows: 40, isFullscreen: true }
const MOUNT = { plugin: 'statusline', surface: 'terminal' as const, component: 'PromptHint' as const, props: HINT, requestId: 'PromptHint', viewport: VIEWPORT }
const PANE_ID = 'statusline-mod'
const PANE = { title: 'Status line', isFocused: true, bodyColumns: 120, placement: 'inline' as const, scroll: { offset: 0, bodyRows: 20 }, view: {} }
const PANE_MOUNT = { plugin: 'statusline', surface: 'terminal' as const, component: 'Pane' as const, props: PANE, requestId: PANE_ID }
const PREFS = 'statusline.prefs.v1'
const DEFAULTS = ['git-branch', 'model', 'context', 'five-hour-limit', 'weekly-limit', 'session', 'cost']

const USAGE = {
  context: { tokens: 83000, window: 1000000, percent: 8 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 25, resetsAt: '2026-09-21T20:00:00Z' },
    { kind: 'seven_day', percentUsed: 61.5 },
  ],
  cost: { usd: 1.2345 },
}
const REPO = { root: '/work/demo', remote: 'git@github.com:konsta95/demo.git', internal: false, name: 'demo' }
const SESSION_ID = '4e1f0c9a-7b2d-4c58-9a36-d1e8f5b2c703'
const OPTION_ROWS = [
  { key: 'statusline.scheme', label: 'Scheme', kind: 'choice', value: 'claude-code', options: ['claude-code', 'codex', 'mono'], provider: { plugin: 'statusline', tier: 'user' }, isLocked: false },
  { key: 'statusline.details', label: 'Details', kind: 'boolean', value: true, provider: { plugin: 'statusline', tier: 'user' }, isLocked: false },
  { key: 'statusline.pin_status', label: 'Pin', kind: 'boolean', value: false, provider: { plugin: 'statusline', tier: 'user' }, isLocked: false },
]

type Mocks = Record<string, (...args: any[]) => unknown>

// The kit refuses a second on("<event>") for the same event, so a test that wants a
// different answer passes it as an override instead of registering twice. The world
// is the nouns the bar reads plus what the command and the pane touch: the store, the
// /config rows, the pane calls and the command registration.
function world(on: On, over: Mocks = {}, store: Record<string, unknown> = {}) {
  const clock = mock.clock(on)
  const persisted = new Map<string, unknown>(Object.entries(store))
  on('store.*', async ($, e, next) => {
    const result = await next(e)
    if (next.is('store.set', e)) persisted.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return result
  })
  mock.store(on, store)
  const opened: unknown[] = []
  const closed: unknown[] = []
  const toasts: string[] = []
  const writes: Array<{ key: string; value: unknown }> = []
  const registered: string[] = []
  const mocks: Mocks = {
    'session.cwd': () => ({ value: '/work/demo/src' }),
    'session.repo': () => ({ value: REPO }),
    'session.model': () => ({ value: 'Fable 5.1' }),
    'session.id': () => ({ value: SESSION_ID }),
    'session.usage': () => ({ value: USAGE }),
    'session.start': (_$: any, e: any) => ({ cwd: e.cwd }),
    'fs.read': (_$: any, e: any) => {
      // /work/demo/src has no .git; the walk must reach /work/demo/.git/HEAD.
      if (e.path === '/work/demo/.git/HEAD') return { value: 'ref: refs/heads/feature/hover\n' }
      throw new Error('ENOENT: ' + e.path)
    },
    'config.list': () => ({ value: OPTION_ROWS.map((row) => ({ ...row })) }),
    'config.set': (_$: any, e: any) => {
      writes.push({ key: e.key, value: e.value })
      return { value: e.value }
    },
    'command.register': (_$: any, e: any) => {
      registered.push(e.name)
      return { value: { command: e.name } }
    },
    'ui.open': (_$: any, e: any) => {
      opened.push(e)
      return { value: undefined }
    },
    'ui.close': (_$: any, e: any) => {
      closed.push(e)
      return { value: undefined }
    },
    'ui.toast': (_$: any, e: any) => {
      toasts.push(e.text)
      return { value: undefined }
    },
    ...over,
  }
  for (const [event, fn] of Object.entries(mocks)) on(event as any, fn as any)
  return { clock, persisted, opened, closed, toasts, writes, registered }
}

const start = ($: Engine) => $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work/demo/src' })
const command = ($: Engine, args = '', isFullscreen = true) =>
  $.command.run({ command: 'statusline-mod', args, origin: { kind: 'composer' }, presentation: { isFullscreen, columns: 140 } })

type Node = { type?: string; key?: string; props?: Record<string, unknown>; hover?: Record<string, unknown>; children?: unknown[] }

function walk(node: unknown, out: Node[] = []): Node[] {
  if (!node || typeof node !== 'object') return out
  const n = node as Node
  out.push(n)
  for (const child of n.children || []) walk(child, out)
  return out
}

function textOf(node: Node): string {
  return (node.children || []).map((c) => (typeof c === 'string' ? c : textOf(c as Node))).join('')
}

// The bar's Text pieces in drawing order: the ones that name a hover scope.
function barText(nodes: Node[]): string {
  return nodes.filter((n) => n.type === 'Text' && typeof n.hover?.scope === 'string').map(textOf).join('')
}

test('the hint line draws the default segments from the session nouns', async ($, on) => {
  world(on)

  const ui = await $.ui.mount(MOUNT)

  expect(await ui.find({ type: 'Text', text: 'demo' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '(feature/hover)' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Fable5.1' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '83K/1M' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '25%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '62%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: SESSION_ID })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '$1.23' })).toBeDefined()
  expect(barText(walk(await ui.drawn()))).toBe('demo(feature/hover)Fable5.183K/1M5h 25%7d 62%' + SESSION_ID + '$1.23')
})

test('every segment names a hover scope that reveals its own card over the row above the bar', async ($, on) => {
  world(on)

  const ui = await $.ui.mount(MOUNT)
  const tree = (await ui.drawn()) as Node
  const nodes = walk(tree)

  const scopesOnText = new Set(nodes.filter((n) => n.type === 'Text' && typeof n.hover?.scope === 'string').map((n) => n.hover!.scope as string))
  const cards = nodes.filter((n) => n.type === 'Box' && n.props?.display === 'none')

  expect([...scopesOnText].sort()).toEqual(['sl-context', 'sl-cost', 'sl-five-hour-limit', 'sl-git-branch', 'sl-model', 'sl-session', 'sl-weekly-limit'])
  expect(cards).toHaveLength(7)
  expect(tree.props?.flexDirection).toBe('row')
  // Each card is placed against the root row, one row up, from the bar's first column:
  // out of the flow, so revealing it gives no sibling less room and moves no row.
  for (const card of cards) {
    expect(tree.children).toContain(card)
    expect(card.props).toMatchObject({ position: 'absolute', top: -1, left: 0 })
    expect(card.hover).toMatchObject({ display: 'flex' })
    expect(scopesOnText.has(card.hover!.scope as string)).toBe(true)
  }
  // What stays in the flow is the bar and the engine hint, nothing a hover can widen.
  const inFlow = (tree.children as Node[]).filter((c) => c.props?.position !== 'absolute')
  expect(inFlow).toHaveLength(2)
  expect(inFlow.some((c) => walk(c).some((n) => n.props?.display === 'none'))).toBe(false)
  expect(textOf(cards.find((b) => b.hover!.scope === 'sl-git-branch')!)).toContain('github konsta95/demo')
  expect(textOf(tree)).not.toContain('<<sl:')
})

test('the engine hint follows the bar, dim, at rest and while working', async ($, on) => {
  world(on)

  const rest = await $.ui.mount(MOUNT)
  expect((await rest.find({ type: 'Text', text: /\? for shortcuts/ }))?.props).toMatchObject({ dimColor: true })
  const drawn = walk(await rest.drawn())
  expect(textOf(drawn[0]).indexOf('$1.23')).toBeLessThan(textOf(drawn[0]).indexOf('? for shortcuts'))

  const working = await $.ui.mount({ ...MOUNT, props: { ...HINT, isWorking: true, hint: 'esc to interrupt' }, requestId: 'working' })
  expect(await working.find({ type: 'Text', text: /esc to interrupt/ })).toBeDefined()
  expect(await working.find({ type: 'Text', text: '83K/1M' })).toBeDefined()
})

test('the stored order is honoured and unknown ids are dropped', async ($, on) => {
  world(on, {}, { [PREFS]: { ids: ['cost', 'github', 'bogus', 'directory', 'cost'] } })

  const ui = await $.ui.mount(MOUNT)
  const nodes = walk(await ui.drawn())

  expect(barText(nodes)).toBe('$1.23konsta95/demosrc')
  expect(nodes.filter((n) => n.type === 'Box' && n.props?.display === 'none').map((n) => n.hover!.scope)).toEqual(['sl-cost', 'sl-github', 'sl-directory'])
})

test('with every segment off the hook passes the hint line through', async ($, on) => {
  world(
    on,
    {
      // Nothing beneath the plugins answers ui.render in the kit; this stands in for
      // the engine's own hint line. A ui.render answer is the tree itself, not { value }.
      'ui.render': (_$: any, e: any) => ({ type: 'Box', props: {}, children: [{ type: 'Text', props: {}, children: ['ENGINE ' + e.component] }] }),
    },
    { [PREFS]: { ids: [] } },
  )

  const ui = await $.ui.mount(MOUNT)

  expect(await ui.find({ type: 'Text', text: 'ENGINE PromptHint' })).toBeDefined()
  expect(await ui.findAll({ type: 'Text', text: '83K/1M' })).toHaveLength(0)
})

test('a failing noun marks its segments and the rest still draw', async ($, on) => {
  world(on, {
    'session.usage': () => {
      throw new Error('usage exploded')
    },
    'fs.read': (_$: any, e: any) => {
      throw new Error('ENOENT: ' + e.path)
    },
  })

  const ui = await $.ui.mount(MOUNT)

  expect(await ui.find({ type: 'Text', text: 'src' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'context!' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'five-hour-limit!' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Fable5.1' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: SESSION_ID })).toBeDefined()
})

test('a model id from the engine draws as its display name and keeps the id in the detail', async ($, on) => {
  world(on, { 'session.model': () => ({ value: 'claude-fable-5-1' }) })

  const ui = await $.ui.mount(MOUNT)
  const nodes = walk(await ui.drawn())

  const barPieces = nodes.filter((n) => n.type === 'Text' && n.hover?.scope === 'sl-model').map(textOf)
  expect(barPieces).toContain('Fable5.1')
  expect(barPieces.some((t) => t.includes('claude-'))).toBe(false)
  expect(textOf(nodes.find((n) => n.type === 'Box' && n.hover?.scope === 'sl-model')!)).toContain('model claude-fable-5-1')
})

test('displayName maps claude ids the way the classic payload names them', async () => {
  const { displayName } = await import('../hooks/statusline')
  expect(displayName('claude-fable-5-1')).toBe('Fable 5.1')
  expect(displayName('claude-opus-5')).toBe('Opus 5')
  expect(displayName('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
  expect(displayName('claude-opus-5-5')).toBe('Opus 5.5')
  expect(displayName('claude-opus-5-5[1m]')).toBe('Opus 5.5')
  expect(displayName('claude-fable-5-1[1m]')).toBe('Fable 5.1')
  expect(displayName('Fable 5.1')).toBe('Fable 5.1')
  expect(displayName('haiku')).toBe('haiku')
})

test('before the first response the context draws 0 of the window, as the classic line does', async ($, on) => {
  world(on, { 'session.usage': () => ({ value: { ...USAGE, context: { window: 1000000 } } }) })

  const ui = await $.ui.mount(MOUNT)

  expect(await ui.find({ type: 'Text', text: '0/1M' })).toBeDefined()
  expect(await ui.findAll({ type: 'Text', text: 'context!' })).toHaveLength(0)
})

test('an effort row among the config rows seeds the level before any turn.step', async ($, on) => {
  world(on, {
    'config.list': () => ({
      value: [{ key: 'effortLevel', label: 'Effort', kind: 'choice', value: 'xhigh', options: ['low', 'medium', 'high', 'xhigh', 'max'], provider: { plugin: 'engine', tier: 'user' }, isLocked: false }],
    }),
  })

  const ui = await $.ui.mount(MOUNT)
  const nodes = walk(await ui.drawn())

  expect(await ui.find({ type: 'Text', text: 'xhigh' })).toBeDefined()
  expect(textOf(nodes.find((n) => n.type === 'Box' && n.hover?.scope === 'sl-model')!)).toContain('effort xhigh')
})

test('the first gathers of a session share one read of the config rows', async ($, on) => {
  let reads = 0
  world(on, {
    'config.list': () => {
      reads += 1
      return { value: OPTION_ROWS.map((row) => ({ ...row })) }
    },
  })

  await Promise.all([start($), $.ui.mount(MOUNT)])

  expect(reads).toBe(1)
})

test('session.start registers /statusline-mod and the bare command opens the dialog pane', async ($, on) => {
  const w = world(on)

  await start($)
  expect(w.registered).toEqual(['statusline-mod'])

  const result = await command($)
  expect(result.text).toBeUndefined()
  expect(w.opened).toHaveLength(1)
  expect(w.opened[0]).toMatchObject({ id: PANE_ID, focus: true, closeOnEscape: true, holdToasts: true })
})

test('show answers with the current line; reset restores the defaults; other args give the usage', async ($, on) => {
  const w = world(on, {}, { [PREFS]: { ids: ['cost', 'model'] } })
  await start($)

  const shown = await command($, 'show')
  expect(shown.text).toContain('Status line: cost, model')
  expect(shown.text).toContain('Not shown: git-branch')
  expect(w.opened).toHaveLength(0)

  const reset = await command($, 'reset')
  expect(reset.text).toContain('reset to')
  expect(w.persisted.get(PREFS)).toEqual({ ids: DEFAULTS })

  const usage = await command($, 'nonsense')
  expect(usage.text).toContain('Usage: /statusline-mod')
})

test('a non-interactive session gets the summary instead of a pane', async ($, on) => {
  const w = world(on)
  await $.session.start({ surface: null, isInteractive: false, cwd: '/work/demo/src' })

  const result = await command($)
  expect(result.text).toContain('Status line: ' + DEFAULTS.join(', '))
  expect(w.opened).toHaveLength(0)
})

test('the pane lists the chosen segments first with digit hotkeys, then the rest', async ($, on) => {
  world(on, {}, { [PREFS]: { ids: ['cost', 'model'] } })
  await start($)

  const ui = await $.ui.mount(PANE_MOUNT)
  const toggles = (await ui.findAll({ type: 'Button' })).filter((b) => (b.key ?? '').startsWith('toggle:'))

  expect(toggles.map((b) => b.key)).toEqual(['toggle:cost', 'toggle:model', 'toggle:git-branch', 'toggle:directory', 'toggle:branch', 'toggle:github', 'toggle:context', 'toggle:five-hour-limit', 'toggle:weekly-limit', 'toggle:session'])
  expect(toggles[0].text).toContain('[x] cost')
  expect(toggles[2].text).toContain('[ ] git branch')
  expect(await ui.find({ key: 'up:cost' })).toBeDefined()
  expect(await ui.find({ key: 'up:git-branch' })).toBeUndefined()
  expect(await ui.find({ type: 'Select', key: 'scheme' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '$1.23' })).toBeDefined()
})

test('toggling and moving a segment persists the new order and redraws the line', async ($, on) => {
  const w = world(on)
  await start($)
  const pane = await $.ui.mount(PANE_MOUNT)

  await pane.press({ key: 'toggle:cost' })
  await w.clock.settle()
  expect(w.persisted.get(PREFS)).toEqual({ ids: DEFAULTS.filter((id) => id !== 'cost') })

  await pane.press({ key: 'down:git-branch' })
  await w.clock.settle()
  expect((w.persisted.get(PREFS) as { ids: string[] }).ids.slice(0, 2)).toEqual(['model', 'git-branch'])

  await pane.press({ key: 'up:git-branch' })
  await pane.press({ key: 'up:git-branch' })
  await w.clock.settle()
  expect((w.persisted.get(PREFS) as { ids: string[] }).ids.slice(0, 2)).toEqual(['git-branch', 'model'])

  await pane.press({ key: 'toggle:github' })
  await w.clock.settle()
  const line = await $.ui.mount(MOUNT)
  expect(barText(walk(await line.drawn()))).toBe('demo(feature/hover)Fable5.183K/1M5h 25%7d 62%' + SESSION_ID + 'konsta95/demo')
  expect(w.toasts).toEqual([])
})

test('the options write this plugin’s own /config rows and close asks the engine to drop the pane', async ($, on) => {
  const w = world(on)
  await start($)
  const pane = await $.ui.mount(PANE_MOUNT)

  await pane.select({ key: 'scheme', value: 'codex' })
  await pane.press({ key: 'details' })
  await pane.press({ key: 'pin' })
  await w.clock.settle()
  expect(w.writes).toEqual([
    { key: 'statusline.scheme', value: 'codex' },
    { key: 'statusline.details', value: false },
    { key: 'statusline.pin_status', value: true },
  ])

  await pane.press({ key: 'reset' })
  await w.clock.settle()
  expect(w.persisted.get(PREFS)).toEqual({ ids: DEFAULTS })

  await pane.press({ key: 'close' })
  await w.clock.settle()
  expect(w.closed).toHaveLength(1)
  expect(w.closed[0]).toMatchObject({ id: PANE_ID, origin: { kind: 'plugin' } })
  expect(w.toasts).toEqual([])
})

test('an option with no /config row is refused with a toast, not a throw', async ($, on) => {
  const w = world(on, { 'config.list': () => ({ value: [] }) })
  await start($)
  const pane = await $.ui.mount(PANE_MOUNT)

  await pane.press({ key: 'details' })
  await w.clock.settle()
  expect(w.writes).toEqual([])
  expect(w.toasts).toHaveLength(1)
  expect(w.toasts[0]).toContain('no /config row for details')
})

const BAD_HOVER = {
  name: 'bad-hover',
  register(on: any) {
    on('ui.render', { component: 'Pane' }, async ($: any, e: any) => {
      const { Box, Text } = await $.ui.resolve(e)

      return Box({ children: [Text({ children: 'no scope, no keyed Box', hover: { bold: true } })] })
    })
  },
}

test('control: a Text hover with no scope under no keyed Box is refused', { plugins: [BAD_HOVER] }, async ($) => {
  await expect($.ui.mount({ plugin: 'bad-hover', surface: 'terminal', component: 'Pane', props: { ...PANE, title: 'Bad hover' }, requestId: 'bad-hover' })).rejects.toThrow(
    /hover has no Box with a key around it/,
  )
})
