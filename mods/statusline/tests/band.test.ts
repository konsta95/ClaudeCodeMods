import { expect, test } from 'claude-code/testing'

const PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 8,
  bodyColumns: 120,
  scroll: { offset: 0, bodyRows: 7 },
  view: {},
}

const MOUNT = {
  plugin: 'statusline',
  surface: 'terminal' as const,
  component: 'AbovePrompt' as const,
  props: PROPS,
  requestId: 'AbovePrompt',
}

const PANE = {
  title: 'Bad hover',
  isFocused: true,
  bodyColumns: 80,
  placement: 'inline' as const,
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
}

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

// The kit refuses a second on("<event>") for the same event, so a test that wants a
// different answer passes it as an override instead of registering twice.
function mockSession(on: any, over: Record<string, (...args: any[]) => unknown> = {}) {
  const mocks: Record<string, (...args: any[]) => unknown> = {
    'session.cwd': () => ({ value: '/work/demo/src' }),
    'session.repo': () => ({ value: REPO }),
    'session.model': () => ({ value: 'Fable 5.1' }),
    'session.id': () => ({ value: SESSION_ID }),
    'session.usage': () => ({ value: USAGE }),
    'fs.read': (_$: any, e: any) => {
      // /work/demo/src has no .git; the walk must reach /work/demo/.git/HEAD.
      if (e.path === '/work/demo/.git/HEAD') return { value: 'ref: refs/heads/feature/hover\n' }
      throw new Error('ENOENT: ' + e.path)
    },
    ...over,
  }
  for (const [event, fn] of Object.entries(mocks)) on(event, fn)
}

type Node = { type?: string; props?: Record<string, unknown>; hover?: Record<string, unknown>; children?: unknown[] }

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

test('the bar draws the default segments from the session nouns', async ($, on) => {
  mockSession(on)

  const ui = await $.ui.mount(MOUNT)

  expect(await ui.find({ type: 'Text', text: 'demo' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '(feature/hover)' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Fable5.1' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '83K/1M' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '25%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '62%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: SESSION_ID })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '$1.23' })).toBeDefined()
})

test('every segment names a hover scope and a hidden detail Box the same scope reveals', async ($, on) => {
  mockSession(on)

  const ui = await $.ui.mount(MOUNT)
  const nodes = walk(await ui.drawn())

  const scopesOnText = new Set(
    nodes.filter((n) => n.type === 'Text' && n.hover && typeof n.hover.scope === 'string').map((n) => n.hover!.scope as string),
  )
  const hiddenBoxes = nodes.filter((n) => n.type === 'Box' && n.props?.display === 'none')

  expect([...scopesOnText].sort()).toEqual(
    ['sl-context', 'sl-cost', 'sl-five-hour-limit', 'sl-git-branch', 'sl-model', 'sl-session', 'sl-weekly-limit'],
  )
  expect(hiddenBoxes).toHaveLength(7)
  for (const box of hiddenBoxes) {
    expect(box.hover).toMatchObject({ display: 'flex' })
    expect(scopesOnText.has(box.hover!.scope as string)).toBe(true)
    expect(textOf(box)).toContain('<<sl:' + (box.hover!.scope as string).slice(3) + '>>')
  }
  expect(textOf(hiddenBoxes.find((b) => b.hover!.scope === 'sl-git-branch')!)).toContain('github konsta95/demo')
})

test('while a survey holds the band the hook passes to what is beneath it', async ($, on) => {
  mockSession(on, {
    // Nothing beneath the plugins answers ui.render in the kit; this stands in for
    // the survey the engine would draw, so a hook that did not pass would hide it.
    // A ui.render answer is the tree itself, not { value }.
    'ui.render': (_$: any, e: any) => ({
      type: 'Box',
      props: {},
      children: [{ type: 'Text', props: {}, children: ['SURVEY ' + e.component] }],
    }),
  })

  const ui = await $.ui.mount({ ...MOUNT, props: { ...PROPS, hasSurvey: true } })

  expect(await ui.find({ type: 'Text', text: 'SURVEY AbovePrompt' })).toBeDefined()
  expect(await ui.findAll({ type: 'Text', text: '83K/1M' })).toHaveLength(0)
})

test('a failing noun marks its segments and the rest still draw', async ($, on) => {
  mockSession(on, {
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

test('a one-row band drops the details row', async ($, on) => {
  mockSession(on)

  const ui = await $.ui.mount({ ...MOUNT, props: { ...PROPS, maxRows: 1 } })
  const nodes = walk(await ui.drawn())

  expect(nodes.filter((n) => n.type === 'Box' && n.props?.display === 'none')).toHaveLength(0)
  expect(await ui.find({ type: 'Text', text: '83K/1M' })).toBeDefined()
})

test('a model id from the engine draws as its display name and keeps the id in the detail', async ($, on) => {
  mockSession(on, { 'session.model': () => ({ value: 'claude-fable-5-1' }) })

  const ui = await $.ui.mount(MOUNT)
  const nodes = walk(await ui.drawn())

  // The bar's own Text pieces (hover scope on the Text) carry the name; the id lives
  // only in the hidden detail Box of the same scope.
  const barPieces = nodes.filter((n) => n.type === 'Text' && n.hover?.scope === 'sl-model').map(textOf)
  expect(barPieces).toContain('Fable5.1')
  expect(barPieces.some((t) => t.includes('claude-'))).toBe(false)
  const detail = nodes.find((n) => n.type === 'Box' && n.hover?.scope === 'sl-model')!
  expect(textOf(detail)).toContain('model claude-fable-5-1')
})

test('displayName maps claude ids the way the classic payload names them', async () => {
  const { displayName } = await import('../hooks/statusline')
  expect(displayName('claude-fable-5-1')).toBe('Fable 5.1')
  expect(displayName('claude-opus-5')).toBe('Opus 5')
  expect(displayName('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
  expect(displayName('Fable 5.1')).toBe('Fable 5.1')
  expect(displayName('haiku')).toBe('haiku')
})

test('before the first response the context draws 0 of the window, as the classic line does', async ($, on) => {
  mockSession(on, { 'session.usage': () => ({ value: { ...USAGE, context: { window: 1000000 } } }) })

  const ui = await $.ui.mount(MOUNT)

  expect(await ui.find({ type: 'Text', text: '0/1M' })).toBeDefined()
  expect(await ui.findAll({ type: 'Text', text: 'context!' })).toHaveLength(0)
})

test('an effort row among the config rows seeds the level before any turn.step', async ($, on) => {
  mockSession(on, {
    'config.list': () => ({
      value: [{ key: 'effortLevel', label: 'Effort', kind: 'choice', value: 'xhigh', options: ['low', 'medium', 'high', 'xhigh', 'max'], provider: { kind: 'engine' }, isLocked: false }],
    }),
  })

  const ui = await $.ui.mount(MOUNT)
  const nodes = walk(await ui.drawn())

  expect(await ui.find({ type: 'Text', text: 'xhigh' })).toBeDefined()
  expect(textOf(nodes.find((n) => n.type === 'Box' && n.hover?.scope === 'sl-model')!)).toContain('effort xhigh')
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
  await expect(
    $.ui.mount({ plugin: 'bad-hover', surface: 'terminal', component: 'Pane', props: PANE, requestId: 'bad-hover' }),
  ).rejects.toThrow(/hover has no Box with a key around it/)
})
