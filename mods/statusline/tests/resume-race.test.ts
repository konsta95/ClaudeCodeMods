import { expect, test } from 'claude-code/testing'
import { MOUNT, USAGE, start, step, world } from './fixtures/options-world'

// 2.1.281 resume body (binary): session.end hooks, classic SessionStart hooks, Ug() switches
// the id noun, several awaits, then St(()=>wt) replaces the transcript. $.session.usage()
// computes the context fill from the transcript snapshot, so between Ug and St the id noun
// names the destination while usage still describes the ended session's transcript.
// The probes advance a poll tick inside that window: menu retries may sample it;
// a running command defers the pending-resume read until command completion.

const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 140 } }

async function has(line: any, text: string) {
  return (await line.find({ type: 'Text', text })) !== undefined
}

// Control: id and usage switch together (what the shipped cases model).
test('W0 control: atomic switch, tick after both', async ($, on) => {
  let id = 'cleared-session'
  let tokens: number | undefined = undefined
  const w = world(on, {
    'session.id': () => ({ value: id }),
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
  id = 'previous-session'
  tokens = 52000
  await w.clock.advance(100)
  const r = { id: await has(line, 'previous-session'), k52: await has(line, '52K/200K'), k0: await has(line, '0/200K'), pin: w.statuses.at(-1) }
  console.log('W0 ' + JSON.stringify(r))
  expect(r.k52).toBe(true)
})

// Rewind menu "resume previous session" from a cleared session: the command returned long
// before; only the poll can refresh. The tick reads the switched id with the old transcript.
test('W1 rewind previous-session: tick between id switch and transcript replace', async ($, on) => {
  let id = 'cleared-session'
  let tokens: number | undefined = undefined
  let usageReads = 0
  const w = world(on, {
    'session.id': () => ({ value: id }),
    'session.usage': () => { usageReads++; return { value: { ...USAGE, context: { tokens, window: 200000 } } } },
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
  id = 'previous-session' // Ug
  await w.clock.advance(100) // one poll tick inside [Ug, St)
  tokens = 52000 // St: the destination transcript is installed
  const readsAtReplace = usageReads
  await w.clock.advance(60000)
  const afterWait = { id: await has(line, 'previous-session'), k52: await has(line, '52K/200K'), k0: await has(line, '0/200K'), pin: w.statuses.at(-1), usageReadsAfterReplace: usageReads - readsAtReplace }
  await line.redraw() // a later keystroke re-renders the hint
  await w.clock.settle()
  const afterRedraw = { k52: await has(line, '52K/200K'), k0: await has(line, '0/200K'), pin: w.statuses.at(-1), usageReadsAfterReplace: usageReads - readsAtReplace }
  console.log('W1 afterWait=' + JSON.stringify(afterWait) + ' afterRedraw=' + JSON.stringify(afterRedraw))
  expect(afterWait.k52).toBe(true)
  expect(afterRedraw.k52).toBe(true)
})

// /resume <other id>: a tick becomes due after the id switch and before transcript
// replacement. The pending resume must survive for the post-command count read.
test('W2 /resume other id: tick inside the command between id switch and transcript replace', async ($, on) => {
  let id = 'session-options'
  let tokens: number | undefined = 37000
  let usageReads = 0
  let w: any
  w = world(on, {
    'session.id': () => ({ value: id }),
    'session.usage': () => { usageReads++; return { value: { ...USAGE, context: { tokens, window: 200000 } } } },
    'session.end': (_$: any, e: any) => ({ sessionId: e.sessionId }),
    'classic.SessionStart': () => ({}),
    'command.run': async () => {
      await $.session.end({ reason: 'resume', sessionId: id, resume: { id } })
      await $.classic.SessionStart({ source: 'resume', session_id: 'target' })
      id = 'target' // Ug
      await w.clock.sleep(100) // the resume body's awaits; one poll tick comes due first
      tokens = 52000 // St
      return {}
    },
  })
  await start($)
  const line = await $.ui.mount(MOUNT)
  await w.clock.settle()
  const run = $.command.run({ command: 'resume', args: 'target', ...RUN })
  await w.clock.advance(100)
  await run
  await w.clock.settle()
  const readsAtReturn = usageReads
  await w.clock.advance(60000)
  const afterReturn = { id: await has(line, 'target'), k52: await has(line, '52K/200K'), k37: await has(line, '37K/200K'), pin: w.statuses.at(-1), usageReadsAfterReturn: usageReads - readsAtReturn }
  await line.redraw()
  await w.clock.settle()
  const afterRedraw = { k52: await has(line, '52K/200K'), k37: await has(line, '37K/200K'), pin: w.statuses.at(-1) }
  // The next request's own refresh reads the destination; an omitted count then shows the retained one.
  tokens = undefined
  await step($)
  await w.clock.settle()
  const omitted = { k52: await has(line, '52K/200K'), k37: await has(line, '37K/200K'), k0: await has(line, '0/200K'), pin: w.statuses.at(-1) }
  console.log('W2 afterReturn=' + JSON.stringify(afterReturn) + ' afterRedraw=' + JSON.stringify(afterRedraw) + ' omittedNextStep=' + JSON.stringify(omitted))
  expect(afterReturn.k52).toBe(true)
  expect(afterRedraw.k52).toBe(true)
  expect(omitted.k52).toBe(true)
})
