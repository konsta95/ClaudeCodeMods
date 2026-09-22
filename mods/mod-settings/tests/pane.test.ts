import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { ConfigRow, ConfigValue, On } from 'claude-code'

const PANE = { title: 'Mod settings', isFocused: true, bodyColumns: 80, placement: 'inline' as const, scroll: { offset: 0, bodyRows: 24 }, view: {} }
const MOUNT = { plugin: 'mod-settings', surface: 'terminal' as const, component: 'Pane' as const, props: PANE, requestId: 'mod-settings' }
const TOGGLE: ConfigRow = { key: 'guardmark.hook_block_marker', label: 'Block the marker command', description: 'Refuse the marker command.', kind: 'boolean', value: true, provider: { plugin: 'guardmark', tier: 'user' }, isLocked: false }
const CHOICE: ConfigRow = { key: 'guardmark.strictness', label: 'Strictness', description: 'What happens on a match.', kind: 'choice', value: 'warn', options: ['off', 'warn', 'block'], provider: TOGGLE.provider, isLocked: false }
const TEXT: ConfigRow = { key: 'guardmark.label', label: 'Label', kind: 'text', value: 'old', provider: TOGGLE.provider, isLocked: false }
const NUMBER: ConfigRow = { key: 'guardmark.limit', label: 'Limit', kind: 'number', value: 3, provider: TOGGLE.provider, isLocked: false }
const ADMISSION = { name: 'guardmark', root: '/fixture/guardmark', tier: 'user', provenance: 'guardmark@inline', events: ['session.start', 'config.set', 'tool.call'] }
const META = { groups: { Safety: ['hook_block_marker', 'strictness'] }, risk: { hook_block_marker: 'caution' }, presets: { Cautious: { hook_block_marker: true, strictness: 'block' }, Quiet: { hook_block_marker: true, strictness: 'warn' } } }
const MANIFEST = { userConfig: { hook_block_marker: { default: true }, strictness: { default: 'block' } } }

function world(on: On, initial: ConfigRow[], options: { metadata?: unknown; store?: Record<string, unknown>; deny?: string; denyByKey?: Record<string, string> } = {}) {
  const clock = mock.clock(on)
  const persisted = new Map<string, unknown>(Object.entries(options.store ?? {}))
  const storeWrites: string[] = []
  on('store.*', async ($, e, next) => {
    const result = await next(e)
    if (next.is('store.set', e)) {
      persisted.set(e.key, JSON.parse(JSON.stringify(e.value)))
      storeWrites.push(e.key)
    }
    return result
  })
  mock.store(on, { 'settings.admissions.v1': [ADMISSION], 'settings.interactive.v1': true, ...options.store })
  const current = initial.map(row => ({ ...row }))
  const writes: Array<{ key: string; value: ConfigValue; previous?: ConfigValue }> = []
  const toasts: string[] = []
  on('config.list', () => ({ value: current.map(row => ({ ...row })) }))
  on('config.set', ($, e) => {
    writes.push({ key: e.key, value: e.value, previous: e.previous })
    if (options.deny) return { deny: options.deny }
    if (options.denyByKey?.[e.key]) return { deny: options.denyByKey[e.key] }
    const row = current.find(item => item.key === e.key)
    if (row) row.value = e.value
    return { value: e.value }
  })
  on('fs.exists', ($, e) => ({ value: e.path.startsWith('/fixture/guardmark/') }))
  on('fs.read', ($, e) => ({ value: e.path.endsWith('plugin.json') ? JSON.stringify(MANIFEST) : e.path.endsWith('README.md') ? 'Guardmark README fixture.' : JSON.stringify(options.metadata ?? META) }))
  on('ui.toast', ($, e) => { toasts.push(e.text); return { value: undefined } })
  on('ui.close', () => ({ value: undefined }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'kit-session' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  return { current, writes, clock, persisted, toasts, storeWrites }
}
const command = ($: Engine, args = '') => $.command.run({ command: 'mods', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })

test('prototype: no plugin rows produces the empty pane', async ($, on) => {
  world(on, [])
  const ui = await $.ui.mount(MOUNT)
  expect(await ui.find({ type: 'Text', text: /No mod settings/ })).toBeDefined()
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
})

test('prototype toggle now drafts first, applies once, and a second apply is empty', async ($, on) => {
  const w = world(on, [TOGGLE])
  const ui = await $.ui.mount(MOUNT)
  expect((await ui.find({ key: 'row:' + TOGGLE.key }))?.text).toContain('[x] Block the marker command')
  await ui.press({ key: 'row:' + TOGGLE.key })
  await w.clock.settle()
  expect(w.writes).toEqual([])
  expect((await ui.find({ key: 'row:' + TOGGLE.key }))?.text).toContain('[ ]')
  await ui.press({ key: 'apply' })
  await w.clock.settle()
  expect(w.writes.map(({ key, value }) => ({ key, value }))).toEqual([{ key: TOGGLE.key, value: false }])
  await ui.press({ key: 'apply' })
  await w.clock.settle()
  expect(w.writes).toHaveLength(1)
})

test('prototype choice cycles on mobile and writes only on apply', async ($, on) => {
  const w = world(on, [CHOICE])
  const ui = await $.ui.mount({ ...MOUNT, surface: 'mobile' })
  await ui.press({ key: 'row:' + CHOICE.key })
  await w.clock.settle()
  expect(w.writes).toEqual([])
  await ui.press({ key: 'apply' })
  await w.clock.settle()
  expect(w.writes[0]?.value).toBe('block')
})

test('known-bad deny is absent before apply, visible after, and retains the draft', async ($, on) => {
  const w = world(on, [TOGGLE], { deny: 'not a boolean' })
  const ui = await $.ui.mount(MOUNT)
  expect(await ui.find({ text: /not a boolean/ })).toBeUndefined()
  await ui.press({ key: 'row:' + TOGGLE.key })
  await w.clock.settle()
  expect(await ui.find({ text: /not a boolean/ })).toBeUndefined()
  await ui.press({ key: 'apply' })
  await w.clock.settle()
  expect((await ui.find({ type: 'Text', text: /not a boolean/ }))?.text).toBe('not a boolean')
  expect((await ui.find({ key: 'row:' + TOGGLE.key }))?.text).toContain('[ ]')
  expect(w.current[0].value).toBe(true)
  expect((w.persisted.get('settings.view.v1') as { draft: Record<string, unknown> }).draft[TOGGLE.key]).toBe(false)
})

test('terminal choices use Select and text and number values use Input', async ($, on) => {
  const w = world(on, [CHOICE, TEXT, NUMBER])
  const ui = await $.ui.mount(MOUNT)
  expect(await ui.find({ type: 'Select', key: 'row:' + CHOICE.key })).toBeDefined()
  expect(await ui.findAll({ type: 'Input' })).toHaveLength(2)
  await ui.select({ key: 'row:' + CHOICE.key, value: 'off' })
  await ui.input({ key: 'row:' + TEXT.key, text: 'true', kind: 'change' })
  await ui.input({ key: 'row:' + NUMBER.key, text: '8' })
  await w.clock.settle()
  expect(w.writes).toEqual([])
  await ui.press({ key: 'apply' })
  await w.clock.settle()
  expect(w.current.map(row => row.value)).toEqual(['off', 'true', 8])
})

test('presets lead their group and apply every declared field', async ($, on) => {
  const w = world(on, [TOGGLE, CHOICE])
  const ui = await $.ui.mount(MOUNT)
  const buttons = await ui.findAll({ type: 'Button' })
  expect(buttons[0].key).toBe('preset:guardmark:Cautious')
  expect(await ui.find({ type: 'Text', text: /^Safety$/ })).toBeDefined()
  await ui.press({ key: 'preset:guardmark:Cautious' })
  await w.clock.settle()
  expect(w.current.map(row => row.value)).toEqual([true, 'block'])
  expect(w.writes).toHaveLength(2)
})

test('reset restores defaults declared in the manifest', async ($, on) => {
  const w = world(on, [{ ...TOGGLE, value: false }, CHOICE])
  const ui = await $.ui.mount(MOUNT)
  await ui.press({ key: 'reset:guardmark' })
  await w.clock.settle()
  expect(w.current.map(row => row.value)).toEqual([true, 'block'])
})

test('undo consumes the stored previous value and removes its entry', async ($, on) => {
  const w = world(on, [{ ...TOGGLE, value: false }], { store: { 'settings.undo.v1': [{ key: TOGGLE.key, previous: true, value: false }] } })
  const ui = await $.ui.mount(MOUNT)
  await ui.press({ key: 'undo' })
  await w.clock.settle()
  expect(w.writes[0]?.value).toBe(true)
  expect(w.persisted.get('settings.undo.v1')).toEqual([])
})

test('undo denial preserves the history and shows the exact reason', async ($, on) => {
  const change = { key: TOGGLE.key, previous: true, value: false }
  const w = world(on, [{ ...TOGGLE, value: false }], { deny: 'policy owns this', store: { 'settings.undo.v1': [change] } })
  const ui = await $.ui.mount(MOUNT)
  await ui.press({ key: 'undo' })
  await w.clock.settle()
  expect(w.persisted.get('settings.undo.v1')).toEqual([change])
  expect((await ui.find({ type: 'Text', text: /policy owns this/ }))?.text).toBe('policy owns this')
})

test('undo refuses to overwrite an intervening edit', async ($, on) => {
  const w = world(on, [{ ...CHOICE, value: 'off' }], { store: { 'settings.undo.v1': [{ key: CHOICE.key, previous: 'warn', value: 'block' }] } })
  const ui = await $.ui.mount(MOUNT)
  await ui.press({ key: 'undo' })
  await w.clock.settle()
  expect(w.writes).toEqual([])
  expect((await ui.find({ type: 'Text', text: /changed since/ }))?.text).toContain('changed since')
})

test('/mods set calls the engine once and prints a deny verbatim', async ($, on) => {
  const w = world(on, [TOGGLE], { deny: 'engine says: not a boolean' })
  const result = await command($, 'set ' + TOGGLE.key + '=invalid')
  expect(result.text).toBe('engine says: not a boolean')
  expect(w.writes).toHaveLength(1)
  expect(w.writes[0].value).toBe('invalid')
})

test('/mods opens an Escape-closing pane and returns a table without writing', async ($, on) => {
  const w = world(on, [TOGGLE, CHOICE])
  const opened: unknown[] = []
  on('ui.open', ($, e) => { opened.push(e); return { value: { isPlaced: true as const } } })
  const result = await command($)
  expect(result.text).toContain(TOGGLE.key)
  expect(result.text).toContain(CHOICE.key)
  expect(opened).toHaveLength(1)
  expect(opened[0]).toMatchObject({ id: 'mod-settings', closeOnEscape: true })
  expect(w.writes).toEqual([])
})

test('print mode returns presets as text and does not ask or write', async ($, on) => {
  const w = world(on, [TOGGLE, CHOICE], { store: { 'settings.interactive.v1': false } })
  const result = await command($, 'guardmark')
  expect(result.text).toContain('Cautious')
  expect(result.text).toContain('Quiet')
  expect(w.writes).toEqual([])
})

test('closing the pane discards its draft', async ($, on) => {
  const w = world(on, [TOGGLE])
  const ui = await $.ui.mount(MOUNT)
  await ui.press({ key: 'row:' + TOGGLE.key })
  await w.clock.settle()
  await ui.press({ key: 'discard' })
  await w.clock.settle()
  expect((w.persisted.get('settings.view.v1') as { draft: unknown }).draft).toEqual({})
  expect(w.writes).toEqual([])
})

test('locked rows cannot acquire a draft by pressing them', async ($, on) => {
  const w = world(on, [{ ...TOGGLE, isLocked: true }])
  const ui = await $.ui.mount(MOUNT)
  await ui.press({ key: 'row:' + TOGGLE.key })
  await w.clock.settle()
  await ui.press({ key: 'apply' })
  await w.clock.settle()
  expect(w.writes).toEqual([])
  expect((await ui.find({ type: 'Text', text: /locked by policy/ }))?.text).toContain('locked')
})

test('unknown preset field refuses the entire preset before writes', async ($, on) => {
  const w = world(on, [TOGGLE], { metadata: { presets: { Bad: { hook_block_marker: false, 'another.key': true } } } })
  const ui = await $.ui.mount(MOUNT)
  await ui.press({ key: 'preset:guardmark:Bad' })
  await w.clock.settle()
  expect(w.writes).toEqual([])
  expect((await ui.find({ type: 'Text', text: /unknown preset\/default field/ }))?.text).toContain('unknown preset/default field')
})

test('the preview shows a real kit dispatch trace and observed admission tier', async ($, on) => {
  world(on, [TOGGLE])
  on('tool.call', () => ({ deny: 'fixture dispatch refused' }))
  const ui = await $.ui.mount(MOUNT)
  const result = await $.tool.call({ tool: 'Bash', command: 'fixture', description: 'No process runs in this mock' })
  expect(result.deny).toBe('fixture dispatch refused')
  await ui.press({ key: 'row:' + TOGGLE.key })
  const preview = (await ui.find({ type: 'Text', text: /Observed load order/ }))?.text ?? ''
  expect(preview).toContain('guardmark [user]')
  expect(preview).toContain('returned')
  expect(preview).toContain(' ms')
})

test('contract probe: a direct config.set hook captures the engine previous input', async ($, on) => {
  const w = world(on, [TOGGLE])
  await $.config.set({ key: TOGGLE.key, value: false, previous: true, provider: TOGGLE.provider, origin: { kind: 'composer' } } as never)
  expect(w.persisted.get('settings.undo.v1')).toEqual([{ key: TOGGLE.key, previous: true, value: false }])
})

test('kit contract: an external write without previous never fabricates an undo entry', async ($, on) => {
  const w = world(on, [TOGGLE])
  const result = await $.config.set({ key: TOGGLE.key, value: false } as never)
  expect(result.value).toBe(false)
  expect(w.writes).toHaveLength(1)
  expect(w.writes[0].previous).toBeUndefined()
  expect(w.persisted.get('settings.undo.v1')).toBeUndefined()
  const ui = await $.ui.mount(MOUNT)
  expect((await ui.find({ type: 'Text', text: /engine did not report the previous value/ }))?.text).toContain('Undo is unavailable')
})

test('a partly denied apply keeps only the denied draft and applies the other key', async ($, on) => {
  const w = world(on, [TOGGLE, CHOICE], { denyByKey: { [TOGGLE.key]: 'toggle refused' } })
  const ui = await $.ui.mount(MOUNT)
  await ui.press({ key: 'row:' + TOGGLE.key })
  await ui.select({ key: 'row:' + CHOICE.key, value: 'off' })
  await w.clock.settle()
  await ui.press({ key: 'apply' })
  await w.clock.settle()
  expect(w.current.map(row => row.value)).toEqual([true, 'off'])
  expect((await ui.find({ type: 'Text', text: /toggle refused/ }))?.text).toBe('toggle refused')
  expect((w.persisted.get('settings.view.v1') as { draft: unknown }).draft).toEqual({ [TOGGLE.key]: false })
})

test('row focus changes the preview without editing the setting', async ($, on) => {
  const w = world(on, [TOGGLE, CHOICE])
  on('ui.focus', () => ({}))
  const ui = await $.ui.mount(MOUNT)
  await $.ui.focus({ requestId: 'mod-settings', component: 'Pane', plugin: 'mod-settings', element: 'row:' + CHOICE.key, origin: { kind: 'person' } })
  await w.clock.settle()
  expect((await ui.find({ type: 'Text', text: /Observed load order/ }))?.text).toContain('Preview: Strictness')
  expect(w.writes).toEqual([])
})

test('a fresh session clears stale admission and draft state without listing rows', async ($, on) => {
  let listed = false
  const w = world(on, [TOGGLE], { store: { 'settings.session.v1': 'old-session', 'settings.view.v1': { draft: { [TOGGLE.key]: false }, errors: {}, focused: '', notice: '', explanation: '' } } })
  on('config.*', async ($, e, next) => { if (next.is('config.list', e)) listed = true; return next(e) })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work/demo' })
  expect(listed).toBe(false)
  expect(w.persisted.get('settings.admissions.v1')).toEqual([])
  expect((w.persisted.get('settings.view.v1') as { draft: unknown }).draft).toEqual({})
})

// $.model.complete resolves a ModelCompleteResult from Claude Code 2.1.280 on, never a bare string.
const USAGE = { input_tokens: 120, output_tokens: 12, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

test('Explain sends the row and README to the model only on demand', async ($, on) => {
  const w = world(on, [TOGGLE])
  const prompts: string[] = []
  on('model.complete', ($, e) => { prompts.push(e.prompt); return { value: { isAnswered: true as const, text: 'This switch blocks the marker.', usage: USAGE } } })
  const ui = await $.ui.mount(MOUNT)
  expect(prompts).toEqual([])
  await ui.press({ key: 'explain:' + TOGGLE.key })
  await w.clock.settle()
  expect(prompts).toHaveLength(1)
  expect(prompts[0]).toContain('Guardmark README fixture.')
  expect(prompts[0]).toContain(TOGGLE.key)
  expect((await ui.find({ type: 'Markdown', key: 'explanation' }))?.text).toContain('This switch blocks')
  expect(w.writes).toEqual([])
})

test('an unanswered explanation says so and the pane still draws', async ($, on) => {
  const w = world(on, [TOGGLE])
  on('model.complete', () => ({ value: { isAnswered: false as const, reason: 'empty-reply' as const, usage: USAGE } }))
  const ui = await $.ui.mount(MOUNT)
  await ui.press({ key: 'explain:' + TOGGLE.key })
  await w.clock.settle()
  expect((await ui.find({ type: 'Markdown', key: 'explanation' }))?.text).toBe('No explanation (empty-reply).')
  expect(await ui.find({ type: 'Button', key: 'apply' })).toBeDefined()
})

test('a view saved with a whole model result as its explanation still draws', async ($, on) => {
  const saved = { draft: {}, errors: {}, focused: '', notice: '', explanation: { isAnswered: true, text: 'saved by 0.2.0 under 2.1.280', usage: USAGE } }
  world(on, [TOGGLE], { store: { 'settings.view.v1': saved } })
  const ui = await $.ui.mount(MOUNT)
  expect(await ui.find({ type: 'Button', key: 'apply' })).toBeDefined()
  expect(await ui.find({ type: 'Markdown', key: 'explanation' })).toBeUndefined()
})

test('quick preset asks through AskUserQuestion and applies the chosen values', async ($, on) => {
  const w = world(on, [TOGGLE, CHOICE])
  const asked: unknown[] = []
  on('tool.call', ($, e) => {
    const input = e as unknown as { tool: string; questions: Array<{ question: string; options: Array<{ label: string }> }> }
    expect(input.tool).toBe('AskUserQuestion')
    asked.push(input.questions)
    return { result: { answers: { [input.questions[0].question]: 'Preset: Cautious' } } }
  })
  const result = await command($, 'guardmark')
  expect(result.text).toContain('guardmark.strictness = "block"')
  expect(asked).toHaveLength(1)
  expect(w.current.map(row => row.value)).toEqual([true, 'block'])
})

test('mobile number editor uses free text from AskUserQuestion and drafts it', async ($, on) => {
  const w = world(on, [NUMBER])
  on('tool.call', ($, e) => {
    const input = e as unknown as { tool: string; questions: Array<{ question: string }> }
    expect(input.tool).toBe('AskUserQuestion')
    return { result: { answers: { [input.questions[0].question]: '12' } } }
  })
  const ui = await $.ui.mount({ ...MOUNT, surface: 'mobile' })
  await ui.press({ key: 'row:' + NUMBER.key })
  await w.clock.settle()
  expect(w.writes).toEqual([])
  expect((await ui.find({ key: 'row:' + NUMBER.key }))?.text).toContain('12')
  await ui.press({ key: 'apply' })
  await w.clock.settle()
  expect(w.current[0].value).toBe(12)
})

test('quick preset pagination respects four options and keeps a preset named Cancel selectable', async ($, on) => {
  const w = world(on, [CHOICE], { metadata: { presets: { One: { strictness: 'warn' }, Two: { strictness: 'block' }, Cancel: { strictness: 'off' } } } })
  const questions: Array<Array<{ label: string }>> = []
  on('tool.call', ($, e) => {
    const input = e as unknown as { tool: string; questions: Array<{ question: string; options: Array<{ label: string }> }> }
    expect(input.tool).toBe('AskUserQuestion')
    questions.push(input.questions[0].options)
    return { result: { answers: { [input.questions[0].question]: questions.length === 1 ? 'More presets…' : 'Preset: Cancel' } } }
  })
  const result = await command($, 'guardmark')
  expect(result.text).toContain('"off"')
  expect(questions.map(options => options.length)).toEqual([4, 3])
  expect(w.current[0].value).toBe('off')
})

test('own Apply records the immediately listed value and Undo restores it', async ($, on) => {
  const w = world(on, [TOGGLE])
  const ui = await $.ui.mount(MOUNT)
  await ui.press({ key: 'row:' + TOGGLE.key })
  await w.clock.settle()
  await ui.press({ key: 'apply' })
  await w.clock.settle()
  expect(w.persisted.get('settings.undo.v1')).toEqual([{ key: TOGGLE.key, previous: true, value: false }])
  await ui.press({ key: 'undo' })
  await w.clock.settle()
  expect(w.current[0].value).toBe(true)
  expect(w.persisted.get('settings.undo.v1')).toEqual([])
})

test('own preset and reset writes are undoable, including the last field of each', async ($, on) => {
  const w = world(on, [{ ...TOGGLE, value: false }, CHOICE])
  const ui = await $.ui.mount(MOUNT)
  await ui.press({ key: 'preset:guardmark:Cautious' })
  await w.clock.settle()
  await ui.press({ key: 'undo' })
  await w.clock.settle()
  expect(w.current.map(row => row.value)).toEqual([true, 'warn'])
  await ui.press({ key: 'undo' })
  await w.clock.settle()
  expect(w.current.map(row => row.value)).toEqual([false, 'warn'])
  await ui.press({ key: 'reset:guardmark' })
  await w.clock.settle()
  await ui.press({ key: 'undo' })
  await w.clock.settle()
  expect(w.current.map(row => row.value)).toEqual([true, 'warn'])
})

test('own command takes a fresh snapshot and an intervening edit blocks its Undo', async ($, on) => {
  const w = world(on, [CHOICE])
  await command($, 'set ' + CHOICE.key + '=block')
  expect(w.persisted.get('settings.undo.v1')).toEqual([{ key: CHOICE.key, previous: 'warn', value: 'block' }])
  w.current[0].value = 'off'
  const ui = await $.ui.mount(MOUNT)
  await ui.press({ key: 'undo' })
  await w.clock.settle()
  expect(w.writes).toHaveLength(1)
  expect(w.current[0].value).toBe('off')
  expect((await ui.find({ type: 'Text', text: /changed since/ }))?.text).toContain('changed since')
})

test('own /mods set is undoable and a no-op or denial adds no history', async ($, on) => {
  const w = world(on, [TOGGLE, CHOICE], { denyByKey: { [CHOICE.key]: 'policy refusal' } })
  await command($, 'set ' + TOGGLE.key + '=false')
  await command($, 'set ' + TOGGLE.key + '=false')
  expect((await command($, 'set ' + CHOICE.key + '=off')).text).toBe('policy refusal')
  expect(w.persisted.get('settings.undo.v1')).toEqual([{ key: TOGGLE.key, previous: true, value: false }])
  const ui = await $.ui.mount(MOUNT)
  await ui.press({ key: 'undo' })
  await w.clock.settle()
  expect(w.current[0].value).toBe(true)
  expect(w.persisted.get('settings.undo.v1')).toEqual([])
})

test('Apply snapshots the value immediately before writing, not when drafting', async ($, on) => {
  const w = world(on, [CHOICE])
  const ui = await $.ui.mount(MOUNT)
  await ui.select({ key: 'row:' + CHOICE.key, value: 'block' })
  await w.clock.settle()
  w.current[0].value = 'off'
  await ui.press({ key: 'apply' })
  await w.clock.settle()
  expect(w.persisted.get('settings.undo.v1')).toEqual([{ key: CHOICE.key, previous: 'off', value: 'block' }])
  await ui.press({ key: 'undo' })
  await w.clock.settle()
  expect(w.current[0].value).toBe('off')
})

test('trace capture is dormant until the pane opens and stops after Discard', async ($, on) => {
  const w = world(on, [TOGGLE])
  const traceWrites = () => w.storeWrites.filter(key => key === 'settings.traces.v1').length
  on('tool.call', () => ({ deny: 'fixture' }))
  const dispatch = () => $.tool.call({ tool: 'Bash', command: 'fixture', description: 'No process runs' })
  await dispatch()
  expect(traceWrites()).toBe(0)
  const ui = await $.ui.mount(MOUNT)
  await dispatch()
  expect(traceWrites()).toBe(1)
  await ui.press({ key: 'discard' })
  await w.clock.settle()
  await dispatch()
  expect(traceWrites()).toBe(1)
})

test('kit admission reachability: this inline replay does not include the mod under test', { plugins: [
  { name: 'admission-world', tier: 'prepend', register(on) {
    const store = new Map<string, unknown>()
    const toasts: string[] = []
    const counts: number[] = []
    const traces: string[][] = []
    on('session.id', () => ({ value: 'admission-session' }))
    on('store.get', ($, e) => ({ value: store.get(e.key) }))
    on('store.set', ($, e) => { store.set(e.key, JSON.parse(JSON.stringify(e.value))); return { value: undefined } })
    on('store.delete', ($, e) => { store.delete(e.key); return { value: undefined } })
    on('ui.toast', ($, e) => { toasts.push(e.text); return { value: undefined } })
    on('plugin.register', async ($, e, next) => {
      if (e.name !== 'toast-subject') return next(e)
      counts.push(toasts.length)
      await next(e)
      traces.push(next.trace.map(entry => entry.plugin))
      counts.push(toasts.length)
      const result = await next(e)
      traces.push(next.trace.map(entry => entry.plugin))
      counts.push(toasts.length)
      return result
    })
    on('tool.call', () => ({ result: { toasts, counts, traces } }))
  } },
  { name: 'toast-subject', tier: 'append', register(on) {} },
] }, async $ => {
  const result = await $.tool.call({ tool: 'Bash', command: 'fixture', description: 'Read admission evidence; no process runs' })
  console.log('ADMISSION_REACH ' + JSON.stringify(result))
  expect(result).toMatchObject({ result: { toasts: [], counts: [0, 0, 0], traces: [['engine'], ['engine']] } })
})
