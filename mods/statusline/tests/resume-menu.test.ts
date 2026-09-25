import { expect, test } from 'claude-code/testing'
import { MOUNT, USAGE, start, world } from './fixtures/options-world'

test('non-command resume: numeric old transcript survives the first destination-id tick', async ($, on) => {
  let id = 'session-options'
  let tokens = 37000
  const w = world(on, {
    'session.id': () => ({ value: id }),
    'session.usage': () => ({ value: { ...USAGE, context: { tokens, window: 200000 } } }),
    'session.end': (_$: any, e: any) => ({ sessionId: e.sessionId }),
    'classic.SessionStart': () => ({}),
  })
  await start($)
  const line = await $.ui.mount(MOUNT)
  await $.session.end({ reason: 'resume', sessionId: id, resume: { id } })
  await $.classic.SessionStart({ source: 'resume', session_id: 'previous-session' })
  id = 'previous-session'
  await w.clock.advance(100)
  // Same observable prefix as the former early-stop test; a numeric count can
  // still belong to the old transcript (owner decision 8bd32e8f454a).
  tokens = 52000
  await w.clock.advance(60000)
  expect(await line.find({ type: 'Text', text: '52K/200K' })).toBeDefined()
})
