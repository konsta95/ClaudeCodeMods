import type { PluginOptions } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import { entropy, register as registerHidevalues, spans } from '../hooks/hidevalues'

const TOKEN = 'Zx9Qw3Er7Ty1Ui5Op2As8Df4Gh6Jk0Lz'
const EMAIL = 'dana@acme.io'
const PAD = 'AAAAAAAAAAAAAAAAAAAAAAAA'
const SHORT = 'aB3xQ9zP1mK7vR2sT'
// The Bash tool's stored stdout carries no trailing newline (measured live, hv2).
const STDOUT = 'API_KEY="' + TOKEN + '"\nLOG_LEVEL="debug"\nOWNER=' + EMAIL + '\nPAD=' + PAD
const RID = 'toolu_01HoverValuesProbe0001'
const COMMAND = 'cat proto/fixture/demo.conf'

// The ToolUse row's props as the terminal raised them in hv2 (2.1.278).
function useProps(over: Record<string, unknown> = {}) {
  return {
    tool_use_id: RID,
    tool: 'Bash',
    input: { command: COMMAND, description: 'Print the demo.conf fixture file' },
    isRunning: false,
    isErrored: false,
    isInterrupted: false,
    output: { stdout: STDOUT, stderr: '', interrupted: false, isImage: false, noOutputExpected: false },
    onScreen: { first: 0, last: 5, of: 6 },
    ...over,
  }
}

function resultProps(over: Record<string, unknown> = {}) {
  return { tool_use_id: RID, tool: 'Bash', output: { stdout: STDOUT + '\n', stderr: '', interrupted: false }, isErrored: false, ...over }
}

// Generic over the props so the mount target keeps the fixture's shape (the kit's
// MountTarget wants the row's declared props, not a bag of unknowns).
function mount<P extends object>(component: 'ToolUse' | 'ToolResult', p: P, plugin = 'hidevalues', rid = RID) {
  return { plugin, surface: 'terminal' as const, component, props: { ...p, tool_use_id: rid }, requestId: rid }
}

// The hook reads PROBE_OUT through $.env and hands a row it leaves alone to the
// engine through next(e); the kit answers both from the test.
function mocks(on: any) {
  mock.env(on, {})
  on('ui.render', (_$: any, e: any) => ({
    type: 'Box',
    props: {},
    children: [{ type: 'Text', props: {}, children: ['ENGINE ROW ' + e.component] }],
  }))
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

test('unit: entropy and spans follow the case-study policy', async () => {
  expect(entropy(PAD)).toEqual(0)
  expect(entropy(TOKEN) >= 4).toEqual(true)
  // The case-study class holds '=', so a bare KEY=value is one token and hides whole; the fixture quotes its values.
  expect(spans('x=' + TOKEN, 20, 4, true)).toEqual([{ text: 'x=' + TOKEN, hidden: true }])
  expect(spans('PAD=' + PAD, 20, 4, true)).toEqual([{ text: 'PAD=' + PAD, hidden: false }])
  expect(spans('x: ' + TOKEN, 20, 4, true)).toEqual([
    { text: 'x: ', hidden: false },
    { text: TOKEN, hidden: true },
  ])
  expect(spans('OWNER=' + EMAIL, 20, 4, false)).toEqual([{ text: 'OWNER=' + EMAIL, hidden: false }])
  expect(spans('OWNER=' + EMAIL, 20, 4, true)).toEqual([
    { text: 'OWNER=', hidden: false },
    { text: EMAIL, hidden: true },
  ])
  // The candidate scan's floor follows min_length: a 17-character run of distinct
  // characters (entropy 4.09) is hidden at 8 and left alone at 20. Review of the
  // first packaged build found the floor hardcoded at 20, so this failed there.
  expect(spans('x: ' + SHORT, 8, 4, true)).toEqual([
    { text: 'x: ', hidden: false },
    { text: SHORT, hidden: true },
  ])
  expect(spans('x: ' + SHORT, 20, 4, true)).toEqual([{ text: 'x: ' + SHORT, hidden: false }])
})

test('ToolUse: the token and the e-mail are hidden with a hover scope under a redrawn header; plain lines are not', async ($, on) => {
  mocks(on)
  const ui = await $.ui.mount(mount('ToolUse', useProps()))
  const texts = walk(await ui.drawn()).filter((n) => n.type === 'Text')

  expect(await ui.find({ type: 'Text', text: '● Bash(' + COMMAND + ')' })).toBeDefined()

  const token = texts.find((n) => textOf(n) === TOKEN)
  expect(token).toBeDefined()
  expect(token!.props!.color).toEqual(token!.props!.backgroundColor)
  expect(typeof token!.hover!.scope).toEqual('string')
  expect(token!.hover!.color).toEqual('#ffd700')
  expect(token!.hover!.underline).toEqual(true)

  const email = texts.find((n) => textOf(n) === EMAIL)
  expect(email).toBeDefined()
  expect(typeof email!.hover!.scope).toEqual('string')
  expect(email!.hover!.scope).not.toEqual(token!.hover!.scope)

  const plain = texts.find((n) => textOf(n) === 'LOG_LEVEL="debug"')
  expect(plain).toBeDefined()
  expect(plain!.hover).toEqual(undefined)
  const pad = texts.find((n) => textOf(n) === 'PAD=' + PAD)
  expect(pad).toBeDefined()
  expect(pad!.hover).toEqual(undefined)

  expect(await ui.find({ type: 'Text', text: '  ⎿  ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '2 hidden values, hover one to reveal it' })).toBeDefined()
  expect(texts.filter((n) => textOf(n).includes('ENGINE ROW'))).toHaveLength(0)
})

test('ToolResult: the same result is redrawn without a header', async ($, on) => {
  mocks(on)
  const ui = await $.ui.mount(mount('ToolResult', resultProps()))
  const texts = walk(await ui.drawn()).filter((n) => n.type === 'Text')
  const token = texts.find((n) => textOf(n) === TOKEN)
  expect(token).toBeDefined()
  expect(typeof token!.hover!.scope).toEqual('string')
  expect(texts.filter((n) => textOf(n).startsWith('● '))).toHaveLength(0)
  expect(await ui.find({ type: 'Text', text: '2 hidden values, hover one to reveal it' })).toBeDefined()
})

test('rows left to the engine: running, errored, interrupted, non-Bash, and nothing to hide', async ($, on) => {
  mocks(on)
  const cases: Array<['ToolUse' | 'ToolResult', ReturnType<typeof useProps> | ReturnType<typeof resultProps>]> = [
    ['ToolUse', useProps({ isRunning: true, output: undefined })],
    ['ToolUse', useProps({ isErrored: true })],
    ['ToolUse', useProps({ isInterrupted: true })],
    ['ToolUse', useProps({ tool: 'Read' })],
    ['ToolUse', useProps({ output: { stdout: 'LOG_LEVEL="debug"', stderr: '', interrupted: false, isImage: false, noOutputExpected: false } })],
    ['ToolResult', resultProps({ isErrored: true })],
    ['ToolResult', resultProps({ tool: 'Read' })],
  ]
  for (const [i, [component, p]] of cases.entries()) {
    const ui = await $.ui.mount(mount(component, p, 'hidevalues', RID + '-' + i))
    expect(await ui.find({ type: 'Text', text: 'ENGINE ROW ' + component })).toBeDefined()
    const texts = walk(await ui.drawn()).filter((n) => n.type === 'Text')
    expect(texts.filter((n) => n.hover !== undefined)).toHaveLength(0)
  }
})

test('ToolUse: stderr is scanned too and drawn dim', async ($, on) => {
  mocks(on)
  const ui = await $.ui.mount(
    mount('ToolUse', useProps({ output: { stdout: '', stderr: 'warn: token ' + TOKEN, interrupted: false, isImage: false, noOutputExpected: false } })),
  )
  const texts = walk(await ui.drawn()).filter((n) => n.type === 'Text')
  const token = texts.find((n) => textOf(n) === TOKEN)
  expect(token).toBeDefined()
  expect(typeof token!.hover!.scope).toEqual('string')
  const warn = texts.find((n) => textOf(n) === 'warn: token ')
  expect(warn).toBeDefined()
  expect(warn!.props!.dimColor).toEqual(true)
  expect(await ui.find({ type: 'Text', text: '1 hidden value, hover one to reveal it' })).toBeDefined()
})

// An inline plugin closes over nothing of the test file, so the option wiring is
// checked by registering the module directly with a capturing `on` and driving the
// hook with a stand-in world: strict options pass the row to the engine untouched.
type Captured = { pattern: string; matcher: unknown; hook: (...args: any[]) => Promise<unknown> }

function capture(options: PluginOptions): Captured {
  const got: Captured[] = []
  const on = (pattern: string, matcher: unknown, hook: any) => {
    got.push({ pattern, matcher, hook })
    return {}
  }
  registerHidevalues(on as any, options)
  return got[0]
}

const el = (type: string) => (p: Record<string, unknown>) => ({ type, props: p, children: [] })
const world = {
  env: { get: async () => undefined },
  ui: { resolve: async () => ({ Box: el('Box'), Text: el('Text') }) },
}
const EVENT = { surface: 'terminal', component: 'ToolUse', requestId: RID, props: useProps() }

test('unit: one registration covers both rows; a threshold above the token entropy and e-mails off pass the row to the engine', async () => {
  const strict = capture({ min_entropy: '6', emails: false })
  expect(strict.pattern).toEqual('ui.render')
  expect(strict.matcher).toEqual({ component: ['ToolUse', 'ToolResult'] })
  expect(await strict.hook(world, EVENT, async () => 'ENGINE')).toEqual('ENGINE')

  const loose = capture({})
  const tree = (await loose.hook(world, EVENT, async () => 'ENGINE')) as { type: string }
  expect(tree.type).toEqual('Box')
})

// The control's tree holds the token as a literal: an inline plugin's register closes
// over nothing of the test file (kit-run2: "TOKEN is not defined").
const BAD_HOVER = {
  name: 'bad-hover',
  register(on: any) {
    on('ui.render', { component: 'ToolUse' }, async ($: any, e: any) => {
      const { Box, Text } = await $.ui.resolve(e)
      return Box({
        children: [Text({ children: 'Zx9Qw3Er7Ty1Ui5Op2As8Df4Gh6Jk0Lz', color: '#3a3a3a', backgroundColor: '#3a3a3a', hover: { color: '#ffd700' } })],
      })
    })
  },
}

test('control: a hidden Text with no scope under no keyed Box is refused', { plugins: [BAD_HOVER] }, async ($, on) => {
  mocks(on)
  // A Read row passes through the mod under test, so the control's own tree is what validation sees.
  await expect($.ui.mount(mount('ToolUse', useProps({ tool: 'Read' }), 'bad-hover'))).rejects.toThrow(/hover has no Box with a key around it/)
})
