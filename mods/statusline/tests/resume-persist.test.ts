import { expect, test } from 'claude-code/testing'
import { MOUNT, USAGE, start, world } from './fixtures/options-world'

const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 140 } }

// W2 again, observing what the hook saves for the destination. The observer is the
// prompt.test.ts pattern: a store.* hook registered before mock.store, passing through.
function observe(on: any) {
  const writes: Array<[string, string, unknown]> = []
  on('store.*', async (_$: any, e: any, next: any) => {
    const result = await next(e)
    if (next.is('store.set', e)) writes.push(['set', e.key, e.value])
    if (next.is('store.delete', e)) writes.push(['delete', e.key, undefined])
    return result
  })
  return writes
}

test('W2b only the post-command count is saved under the destination key', async ($, on) => {
  const writes = observe(on)
  let id = 'session-options'
  let tokens: number | undefined = 37000
  let w: any
  w = world(on, {
    'session.id': () => ({ value: id }),
    'session.usage': () => ({ value: { ...USAGE, context: { tokens, window: 200000 } } }),
    'session.end': (_$: any, e: any) => ({ sessionId: e.sessionId }),
    'classic.SessionStart': () => ({}),
    'command.run': async () => {
      await $.session.end({ reason: 'resume', sessionId: id, resume: { id } })
      await $.classic.SessionStart({ source: 'resume', session_id: 'target' })
      id = 'target'
      await w.clock.sleep(100)
      tokens = 52000
      return {}
    },
  })
  await start($)
  await $.ui.mount(MOUNT)
  await w.clock.settle()
  const run = $.command.run({ command: 'resume', args: 'target', ...RUN })
  await w.clock.advance(100)
  await run
  await w.clock.advance(1000)
  const target = writes.filter(([, k]) => k === 'statusline.context.v1:target')
  console.log('W2b targetWrites=' + JSON.stringify(target) + ' all=' + JSON.stringify(writes.filter(([, k]) => String(k).startsWith('statusline.context'))))
  expect(target.at(-1)?.[2]).toBe(52000)
  expect(target.some(([, , value]) => value === 37000)).toBe(false)
})

// Control: the same flow with the transcript replaced before the tick.
test('W2c control: transcript replaced before the tick', async ($, on) => {
  const writes = observe(on)
  let id = 'session-options'
  let tokens: number | undefined = 37000
  let w: any
  w = world(on, {
    'session.id': () => ({ value: id }),
    'session.usage': () => ({ value: { ...USAGE, context: { tokens, window: 200000 } } }),
    'session.end': (_$: any, e: any) => ({ sessionId: e.sessionId }),
    'classic.SessionStart': () => ({}),
    'command.run': async () => {
      await $.session.end({ reason: 'resume', sessionId: id, resume: { id } })
      await $.classic.SessionStart({ source: 'resume', session_id: 'target' })
      id = 'target'
      tokens = 52000
      await w.clock.sleep(100)
      return {}
    },
  })
  await start($)
  await $.ui.mount(MOUNT)
  await w.clock.settle()
  const run = $.command.run({ command: 'resume', args: 'target', ...RUN })
  await w.clock.advance(100)
  await run
  await w.clock.advance(1000)
  const target = writes.filter(([, k]) => k === 'statusline.context.v1:target')
  console.log('W2c targetWrites=' + JSON.stringify(target))
  expect(target.at(-1)?.[2]).toBe(52000)
})
