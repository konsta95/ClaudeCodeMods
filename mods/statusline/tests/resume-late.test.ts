import { expect, test } from 'claude-code/testing'
import { MOUNT, USAGE, start, world } from './fixtures/options-world'

const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 140 } }

for (const missing of ['omitted', 'error'] as const) {
  test('command resume waits for a reported count after ' + missing + ', and zero completes it', async ($, on) => {
    let id = 'session-options'
    let tokens: number | undefined = 37000
    let failed = false
    let reads = 0
    const w = world(on, {
      'session.id': () => { reads++; return { value: id } },
      'session.usage': () => {
        if (failed) throw new Error('destination usage unavailable')
        return { value: { ...USAGE, context: { tokens, window: 200000 } } }
      },
      'session.end': (_$: any, e: any) => ({ sessionId: e.sessionId }),
      'command.run': async () => {
        await $.session.end({ reason: 'resume', sessionId: id, resume: { id } })
        id = 'target'
        tokens = undefined
        failed = missing === 'error'
        return {}
      },
    })
    await start($)
    await $.ui.mount(MOUNT)
    await $.command.run({ command: 'resume', args: 'target', ...RUN })
    const missingReads = reads
    await w.clock.advance(1000)
    expect(reads).toBeGreaterThan(missingReads)
    failed = false
    tokens = 0
    await w.clock.advance(100)
    const completedReads = reads
    await w.clock.advance(60000)
    expect(reads).toBe(completedReads)
  })
}

for (const path of ['menu', 'command'] as const) {
  test(path + ' resume polling expires even when destination count never arrives', async ($, on) => {
    let id = 'session-options'
    let reads = 0
    const w = world(on, {
      'session.id': () => { reads++; return { value: id } },
      'session.usage': () => ({ value: { ...USAGE, context: { window: 200000 } } }),
      'session.end': (_$: any, e: any) => ({ sessionId: e.sessionId }),
      'command.run': async () => {
        await $.session.end({ reason: 'resume', sessionId: id, resume: { id } })
        id = 'target'
        return {}
      },
    })
    await start($)
    if (path === 'command') await $.command.run({ command: 'resume', args: 'target', ...RUN })
    else {
      await $.session.end({ reason: 'resume', sessionId: id, resume: { id } })
      id = 'target'
    }
    const before = reads
    await w.clock.advance(1000)
    expect(reads).toBeGreaterThan(before)
    await w.clock.advance(4000)
    const expired = reads
    await w.clock.advance(60000)
    expect(reads).toBe(expired)
  })
}

// Binding within the resume retry window can refresh without another input.
test('L1 binding at 3 s after the resume end', async ($, on) => {
  let id = 'cleared-session'
  let tokens: number | undefined = undefined
  let idReads = 0
  const w = world(on, {
    'session.id': () => { idReads++; return { value: id } },
    'session.usage': () => ({ value: { ...USAGE, context: { tokens, window: 200000 } } }),
    'session.end': (_$: any, e: any) => ({ sessionId: e.sessionId }),
    'classic.SessionStart': () => ({}),
    'command.run': () => ({}),
  })
  await start($)
  const line = await $.ui.mount(MOUNT)
  await w.clock.settle()
  await $.command.run({ command: 'rewind', args: '', ...RUN })
  await $.session.end({ reason: 'resume', sessionId: id, resume: { id } })
  await $.classic.SessionStart({ source: 'resume', session_id: 'previous-session' })
  await w.clock.advance(3000)
  const before = idReads
  id = 'previous-session'
  tokens = 52000
  await w.clock.advance(100)
  const r = { idReadsIn100ms: idReads - before, k52: (await line.find({ type: 'Text', text: '52K/200K' })) !== undefined, pin: w.statuses.at(-1) }
  console.log('L1 ' + JSON.stringify(r))
  expect(r.k52).toBe(true)
})
