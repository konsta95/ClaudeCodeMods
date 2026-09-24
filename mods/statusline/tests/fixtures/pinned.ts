import { expect, test } from 'claude-code/testing'
import { MOUNT, USAGE, start, step, world } from './options-world'

for (const component of ['preview', 'hint'] as const) {
test(`a delayed ${component} cannot pin a segment that was turned off while usage was pending`, async ($, on) => {
  let hold = false, removing = false
  let release!: () => void, reached!: () => void, changed!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  const reading = new Promise<void>(resolve => { reached = resolve })
  const removed = new Promise<void>(resolve => { changed = resolve })
  const statuses: string[] = []
  const messages = [{ role: 'user' as const, text: 'Conversation', toolUses: [] }]
  world(on, {
    'session.usage': async () => {
      if (hold) { hold = false; reached(); await held }
      return { value: USAGE }
    },
    'session.compact': () => ({ messages }),
    'ui.status': (_$: any, e: any) => {
      statuses.push(e.text)
      if (removing && !e.text.includes('$1.23')) changed()
      return { value: undefined }
    },
  })
  await start($)
  const line = await $.ui.mount(MOUNT)
  await $.command.run({ command: 'statusline-mod', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 140 } })
  const band = await $.ui.mount({
    plugin: 'statusline', surface: 'terminal', component: 'AbovePrompt', requestId: 'band',
    props: { hasSurvey: false, isWorking: false, maxRows: 29, bodyColumns: 140, scroll: { offset: 0, bodyRows: 29 }, view: {} },
  })
  await $.session.compact({ trigger: 'manual', messages })
  hold = true
  const drawing = component === 'hint' ? line.redraw() : band.redraw()
  await reading
  removing = true
  const toggling = band.press({ key: 'segment:cost' })
  await removed
  const afterRemoval = statuses.length
  release()
  await drawing
  await toggling
  expect(statuses.slice(afterRemoval).some(text => text.includes('$1.23'))).toBe(false)
  expect(await band.find({ type: 'Text', text: '$1.23' })).toBeUndefined()
  expect(await line.find({ type: 'Text', text: '$1.23' })).toBeUndefined()
})
}

test('a preview-only wait draw updates the pin without acknowledging the hint', async ($, on) => {
  let context: Record<string, number> = { tokens: 37000, window: 200000 }
  const messages = [{ role: 'user' as const, text: 'Conversation', toolUses: [] }]
  const w = world(on, {
    'session.usage': () => ({ value: { ...USAGE, context } }),
    'session.compact': () => ({ messages }),
    'command.run': () => ({}),
  })
  await start($)
  const line = await $.ui.mount(MOUNT)
  await $.command.run({ command: 'statusline-mod', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 140 } })
  const band = await $.ui.mount({
    plugin: 'statusline', surface: 'terminal', component: 'AbovePrompt', requestId: 'band',
    props: { hasSurvey: false, isWorking: false, maxRows: 29, bodyColumns: 140, scroll: { offset: 0, bodyRows: 29 }, view: {} },
  })
  await $.session.compact({ trigger: 'manual', messages })
  await w.clock.settle()
  const before = w.statuses.length
  context = { window: 200000 }
  await band.redraw()
  expect(w.statuses.slice(before)).toHaveLength(1)
  expect(w.statuses[before]).toContain('0/200K')
  expect(await line.find({ type: 'Text', text: '37K/200K' })).toBeDefined()
  await $.command.run({ command: 'model', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 140 } })
  await w.clock.settle()
  expect(await line.find({ type: 'Text', text: '0/200K' })).toBeDefined()
  expect(w.statuses.slice(before)).toHaveLength(1)
})

for (const order of ['draw-then-refresh', 'refresh-then-draw'] as const) {
  test('post-compaction pin never goes back to an older refresh: ' + order, async ($, on) => {
    let context: Record<string, number> = { tokens: 37000, window: 200000 }
    const messages = [{ role: 'user' as const, text: 'Conversation', toolUses: [] }]
    let holdId = false
    let release!: () => void, reached!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    const reading = new Promise<void>(resolve => { reached = resolve })
    const w = world(on, {
      'session.id': async () => { if (holdId) { holdId = false; reached(); await held }; return { value: 'session-options' } },
      'session.usage': () => ({ value: { context, cost: { usd: 1.2345 } } }),
      'session.compact': () => ({ messages }),
      'command.run': () => ({}),
    })
    await start($)
    await $.ui.mount(MOUNT)
    await $.session.compact({ trigger: 'manual', messages })
    await w.clock.settle()
    const before = w.statuses.length
    holdId = true
    const refreshing = $.command.run({ command: 'compact', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 140 } })
    await reading
    context = { window: 200000 }
    w.redraws.length = 0
    if (order === 'draw-then-refresh') {
      await $.ui.mount({ ...MOUNT, requestId: 'installed-compact' })
      release()
      await refreshing
    } else {
      release()
      await refreshing
      await $.ui.mount({ ...MOUNT, requestId: 'installed-compact' })
    }
    await w.clock.settle()
    expect(w.statuses.slice(before)).toHaveLength(1)
    expect(w.statuses[before]).toContain('0/200K')
    expect(w.redraws).toHaveLength(0)
  })
}

// Run in the scratch option fixture described in README.md, with pin_status=true.
test('pin_status is set when the hint draws before session.start and ignores unchanged refreshes', async ($, on) => {
  const w = world(on)
  const line = await $.ui.mount(MOUNT)
  await start($)
  await w.clock.settle()
  expect(await line.find({ type: 'Text', text: '37K/200K' })).toBeDefined()
  expect(w.statuses).toHaveLength(1)
  expect(w.statuses[0]).toContain('37K/200K')
  await start($)
  await w.clock.settle()
  expect(w.statuses).toHaveLength(1)
})

test('pin_status is set when a hint draw finishes during the startup gather', async ($, on) => {
  let reads = 0
  let release!: () => void
  const held = new Promise<void>((resolve) => (release = resolve))
  let holding!: () => void
  const startedRead = new Promise<void>((resolve) => (holding = resolve))
  const w = world(on, {
    'session.usage': async () => {
      if (++reads === 1) { holding(); await held }
      return { value: USAGE }
    },
  })
  const starting = start($)
  await startedRead
  const line = await $.ui.mount(MOUNT)
  expect(await line.find({ type: 'Text', text: '37K/200K' })).toBeDefined()
  release()
  await starting
  await w.clock.settle()
  expect(w.statuses).toHaveLength(1)
  expect(w.statuses[0]).toContain('37K/200K')
})

test('pin_status follows an effort change even when the hint line draws it before refresh finishes', async ($, on) => {
  let hold = false
  let release!: () => void
  const held = new Promise<void>((resolve) => (release = resolve))
  let holding!: () => void
  const startedRead = new Promise<void>((resolve) => (holding = resolve))
  const w = world(on, {
    'session.usage': async () => {
      if (hold) { hold = false; holding(); await held }
      return { value: USAGE }
    },
  })
  await start($)
  await w.clock.settle()
  expect(w.statuses).toHaveLength(1)
  expect(w.statuses[0]).not.toContain('max')
  hold = true
  const stepping = step($)
  await startedRead
  const line = await $.ui.mount(MOUNT)
  expect(await line.find({ type: 'Text', text: 'max' })).toBeDefined()
  release()
  await stepping
  await w.clock.settle()
  expect(w.statuses).toHaveLength(2)
  expect(w.statuses[1]).toContain('Haiku4.5 max')
  await step($)
  await w.clock.settle()
  expect(w.statuses).toHaveLength(2)
})
