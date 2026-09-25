import { expect, test } from 'claude-code/testing'
import { MOUNT, start, step, world } from './fixtures/options-world'

// Compatibility with 0.3.3, not a claim about an unmeasured engine effort setting.
for (const path of ['clear', 'resume-same', 'resume-other']) {
  test('F1 keeps the last supplied effort across ' + path, async ($, on) => {
    let id = 'session-options'
    const command = path === 'clear' ? 'clear' : 'resume'
    const w = world(on, {
      'session.model': () => ({ value: 'Fable 5.1' }),
      'session.id': () => ({ value: id }),
      'session.end': (_$: any, e: any) => ({ sessionId: e.sessionId }),
      'command.run': async () => {
        await $.session.end({ reason: command, sessionId: id, resume: { id } })
        if (path !== 'resume-same') id = 'after-' + path
        return command === 'clear' ? { ref: 0 } : {}
      },
    })
    await start($)
    await step($, 'max')
    const line = await $.ui.mount(MOUNT)
    expect(await line.find({ type: 'Text', text: 'max' })).toBeDefined()
    await $.command.run({ command, args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 140 } })
    await w.clock.settle()
    await line.redraw()
    expect(await line.find({ type: 'Text', text: 'Fable5.1' })).toBeDefined()
    expect(await line.find({ type: 'Text', text: 'max' })).toBeDefined()
  })
}

test('pin off clears a prior activation while selected segments still draw', async ($, on) => {
  const w = world(on)
  const line = await $.ui.mount(MOUNT)
  await start($)
  await w.clock.settle()
  expect(await line.find({ type: 'Text', text: '37K/200K' })).toBeDefined()
  expect(w.statuses).toEqual([undefined])
})

for (const command of ['resume', 'branch']) {
  test(command + ' refreshes the selected session before another request', async ($, on) => {
    let id = 'session-options'
    let tokens: number | undefined = 37000
    const w = world(on, {
      'session.id': () => ({ value: id }),
      'session.usage': () => ({ value: { context: { tokens, window: 200000 } } }),
      'session.end': (_$: any, e: any) => ({ sessionId: e.sessionId }),
      'command.run': async () => {
        await $.session.end({ reason: 'resume', sessionId: id, resume: { id } })
        id = command + '-target'
        tokens = 52000
        return {}
      },
    })
    await start($)
    const line = await $.ui.mount(MOUNT)
    await $.command.run({ command, args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 140 } })
    await w.clock.settle()
    expect(await line.find({ type: 'Text', text: id })).toBeDefined()
    expect(await line.find({ type: 'Text', text: '52K/200K' })).toBeDefined()
    tokens = undefined
    await step($)
    await w.clock.settle()
    expect(await line.find({ type: 'Text', text: '52K/200K' })).toBeDefined()
  })
}

test('rewind previous-session selection refreshes without another input or render', async ($, on) => {
  let id = 'session-options'
  let tokens: number | undefined = 37000
  const w = world(on, {
    'session.id': () => ({ value: id }),
    'session.usage': () => ({ value: { context: { tokens, window: 200000 } } }),
    'session.end': (_$: any, e: any) => ({ sessionId: e.sessionId }),
    'classic.SessionStart': () => ({}),
    'command.run': () => ({}),
  })
  await start($)
  const line = await $.ui.mount(MOUNT)
  await $.command.run({ command: 'rewind', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 140 } })
  // These events occur only when the person later selects "previous session".
  await $.session.end({ reason: 'resume', sessionId: id, resume: { id } })
  await $.classic.SessionStart({ source: 'resume', session_id: 'previous-session' })
  await line.redraw()
  expect(await line.find({ type: 'Text', text: 'previous-session' })).toBeUndefined()
  id = 'previous-session'
  tokens = 52000
  await w.clock.advance(100)
  expect(await line.find({ type: 'Text', text: id })).toBeDefined()
  expect(await line.find({ type: 'Text', text: '52K/200K' })).toBeDefined()
  tokens = undefined
  await step($)
  await w.clock.settle()
  expect(await line.find({ type: 'Text', text: '52K/200K' })).toBeDefined()
})

test('bar changes redraw no transcript row', async ($, on) => {
  const rows: string[] = []
  let tokens = 37000
  const w = world(on, {
    'session.usage': () => ({ value: { context: { tokens, window: 200000 } } }),
    'ui.render': (_$: any, e: any) => {
      if (e.component === 'TurnDuration') rows.push(e.requestId)
      return { type: 'Text', props: {}, children: ['engine ' + e.component] }
    },
  })
  await start($)
  const line = await $.ui.mount(MOUNT)
  for (let i = 0; i < 30; i++) {
    await $.ui.mount({ plugin: 'statusline', surface: 'terminal', component: 'TurnDuration', requestId: 'row-' + i, props: { word: 'Baked', durationMs: 1000 } })
  }
  await w.clock.settle()
  rows.length = 0
  for (let i = 0; i < 3; i++) {
    tokens += 5000
    await step($)
    await w.clock.settle()
  }
  expect(await line.find({ type: 'Text', text: '52K/200K' })).toBeDefined()
  expect(rows).toEqual([])
})

test('same-id resume rearms retention for the next omitted count', async ($, on) => {
  let tokens: number | undefined = 37000
  const w = world(on, {
    'session.usage': () => ({ value: { context: { tokens, window: 200000 } } }),
    'session.end': (_$: any, e: any) => ({ sessionId: e.sessionId }),
    'command.run': async () => {
      await $.session.end({ reason: 'resume', sessionId: 'session-options', resume: { id: 'session-options' } })
      tokens = 52000
      return {}
    },
  })
  await start($)
  const line = await $.ui.mount(MOUNT)
  await $.command.run({ command: 'resume', args: 'session-options', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 140 } })
  await w.clock.settle()
  expect(await line.find({ type: 'Text', text: '52K/200K' })).toBeDefined()
  tokens = undefined
  await step($)
  await w.clock.settle()
  expect(await line.find({ type: 'Text', text: '52K/200K' })).toBeDefined()
})

// This ordering is a defensive case, not an engine ordering observed live.
test('a command returning before the destination binds cannot rearm the ended id', async ($, on) => {
  let id = 'session-options'
  let tokens: number | undefined = 37000
  const w = world(on, {
    'session.id': () => ({ value: id }),
    'session.usage': () => ({ value: { context: { tokens, window: 200000 } } }),
    'session.end': (_$: any, e: any) => ({ sessionId: e.sessionId }),
    'classic.SessionStart': () => ({}),
    'command.run': async () => {
      await $.session.end({ reason: 'resume', sessionId: id, resume: { id } })
      await $.classic.SessionStart({ source: 'resume', session_id: 'late-target' })
      return {}
    },
  })
  await start($)
  const line = await $.ui.mount(MOUNT)
  await w.clock.settle()
  await $.command.run({ command: 'resume', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 140 } })
  tokens = undefined
  await step($)
  await w.clock.settle()
  expect(await line.find({ type: 'Text', text: '0/200K' })).toBeDefined()
  id = 'late-target'
  tokens = 52000
  await w.clock.advance(100)
  expect(await line.find({ type: 'Text', text: id })).toBeDefined()
  expect(await line.find({ type: 'Text', text: '52K/200K' })).toBeDefined()
})

test('resume polling is idle normally and expires when no destination binds', async ($, on) => {
  let reads = 0
  const w = world(on, {
    'session.id': () => { reads++; return { value: 'session-options' } },
    'session.end': (_$: any, e: any) => ({ sessionId: e.sessionId }),
  })
  await start($)
  await $.ui.mount(MOUNT)
  await w.clock.settle()
  const idle = reads
  await w.clock.advance(10000)
  expect(reads).toBe(idle)
  await $.session.end({ reason: 'resume', sessionId: 'session-options', resume: { id: 'session-options' } })
  await w.clock.advance(1000)
  expect(reads).toBeGreaterThan(idle)
  await w.clock.advance(4000)
  const expired = reads
  await w.clock.advance(60000)
  expect(reads).toBe(expired)
})

for (const reason of ['clear', 'other'] as const) {
  test('resume polling stops when session end becomes ' + reason, async ($, on) => {
    let reads = 0
    const w = world(on, {
      'session.id': () => { reads++; return { value: 'session-options' } },
      'session.end': (_$: any, e: any) => ({ sessionId: e.sessionId }),
    })
    await start($)
    await $.session.end({ reason: 'resume', sessionId: 'session-options', resume: { id: 'session-options' } })
    await w.clock.advance(100)
    await $.session.end({ reason, sessionId: 'session-options', resume: { id: 'session-options' } })
    const stopped = reads
    await w.clock.advance(60000)
    expect(reads).toBe(stopped)
  })
}

test('menu resume polling continues after a count read and stops at expiry', async ($, on) => {
  let id = 'session-options'
  let reads = 0
  const w = world(on, {
    'session.id': () => { reads++; return { value: id } },
    'session.end': (_$: any, e: any) => ({ sessionId: e.sessionId }),
    'classic.SessionStart': () => ({}),
  })
  await start($)
  const line = await $.ui.mount(MOUNT)
  await $.session.end({ reason: 'resume', sessionId: id, resume: { id } })
  await $.classic.SessionStart({ source: 'resume', session_id: 'previous-session' })
  id = 'previous-session'
  await w.clock.advance(100)
  expect(await line.find({ type: 'Text', text: id })).toBeDefined()
  const firstRead = reads
  await w.clock.advance(3900)
  expect(reads).toBeGreaterThan(firstRead)
  await w.clock.advance(1000)
  const stopped = reads
  await w.clock.advance(60000)
  expect(reads).toBe(stopped)
})
