import { expect, test } from 'claude-code/testing'
import { MOUNT, USAGE, start, step, world } from './options-world'

// Run in the scratch option fixture described in README.md, with details=false.
test('with details off, hover-only usage changes request no redraw; a visible change still does', async ($, on) => {
  let usage = USAGE
  const w = world(on, { 'session.usage': () => ({ value: usage }) })
  await start($)
  const line = await $.ui.mount(MOUNT)
  await $.command.run({ command: 'statusline-mod', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 140 } })
  await $.ui.mount({
    plugin: 'statusline', surface: 'terminal', component: 'AbovePrompt', requestId: 'band',
    props: { hasSurvey: false, isWorking: false, maxRows: 29, bodyColumns: 140, scroll: { offset: 0, bodyRows: 29 }, view: {} },
  })
  await step($)
  await w.clock.settle()
  const before = await line.drawn()
  expect(await line.find({ type: 'Text', text: /cost .* this session/ })).toBeUndefined()
  w.redraws.length = 0
  usage = { context: { tokens: 37001, window: 200000 }, cost: { usd: 1.2346 } }
  await step($)
  await w.clock.settle()
  expect(await line.drawn()).toEqual(before)
  expect(w.redraws).toEqual([])
  usage = { ...usage, cost: { usd: 2.34 } }
  await step($)
  await w.clock.settle()
  expect(w.redraws).toEqual(['ui.render'])
  expect(await line.find({ type: 'Text', text: '$2.34' })).toBeDefined()
})
