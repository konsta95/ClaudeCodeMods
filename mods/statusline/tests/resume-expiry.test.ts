import { expect, test } from 'claude-code/testing'
import { MOUNT, USAGE, start, step, world } from './fixtures/options-world'

const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 140 } }
const BAND = {
  plugin: 'statusline', surface: 'terminal' as const, component: 'AbovePrompt' as const, requestId: 'band',
  props: { hasSurvey: false, isWorking: false, maxRows: 29, bodyColumns: 140, scroll: { offset: 0, bodyRows: 29 }, view: {} },
}

for (const path of ['menu-count', 'menu-omitted', 'command-count', 'command-omitted'] as const) {
  test('expiry ends cached hint and band retries: ' + path, async ($, on) => {
    let id = 'session-options'
    let tokens: number | undefined = 37000
    let usageReads = 0, idReads = 0
    const resume = async () => {
      await $.session.end({ reason: 'resume', sessionId: id, resume: { id } })
      await $.classic.SessionStart({ source: 'resume', session_id: 'target' })
      id = 'target'
      tokens = path.endsWith('omitted') ? undefined : 52000
    }
    const w = world(on, {
      'session.id': () => { idReads++; return { value: id } },
      'session.usage': () => { usageReads++; return { value: { ...USAGE, context: { tokens, window: 200000 } } } },
      'session.end': (_$: any, e: any) => ({ sessionId: e.sessionId }),
      'classic.SessionStart': () => ({}),
      'command.run': async () => { await resume(); return {} },
    })
    await start($)
    const line = await $.ui.mount(MOUNT)
    const band = await $.ui.mount(BAND)
    if (path.startsWith('command')) await $.command.run({ command: 'resume', args: 'target', ...RUN })
    else await resume()
    await w.clock.advance(5000)
    const expired = { usage: usageReads, id: idReads }
    for (let i = 0; i < 10; i++) {
      await line.redraw()
      await band.redraw()
    }
    expect({ usage: usageReads, id: idReads }).toEqual(expired)

    // Ordinary refreshes still recover later usage without reviving resume retries.
    tokens = 61000
    await line.redraw({ ...MOUNT.props, isWorking: true })
    await band.redraw({ ...BAND.props, isWorking: true })
    await step($)
    await line.redraw({ ...MOUNT.props, isWorking: false })
    await band.redraw({ ...BAND.props, isWorking: false })
    await w.clock.settle()
    expect(await line.find({ type: 'Text', text: '61K/200K' })).toBeDefined()
    expect(usageReads - expired.usage).toBe(2)
    expect(idReads - expired.id).toBe(1)
    const refreshed = { usage: usageReads, id: idReads }
    await w.clock.advance(60000)
    await line.redraw()
    await band.redraw()
    expect({ usage: usageReads, id: idReads }).toEqual(refreshed)
  })
}
