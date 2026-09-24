import { mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

export const MOUNT = {
  plugin: 'statusline', surface: 'terminal' as const, component: 'PromptHint' as const,
  props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
  requestId: 'PromptHint', viewport: { columns: 140, rows: 40, isFullscreen: true },
}
export const USAGE = { context: { tokens: 37000, window: 200000 }, cost: { usd: 1.2345 } }
const RESULT = { turnId: 'turn', index: 0, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }

export function world(on: On, over: Record<string, (...args: any[]) => unknown> = {}) {
  const clock = mock.clock(on)
  mock.store(on, {})
  const statuses: string[] = []
  const redraws: string[] = []
  const mocks = {
    'session.cwd': () => ({ value: '/work/demo' }),
    'session.repo': () => ({ value: null }),
    'session.model': () => ({ value: 'claude-haiku-4-5' }),
    'session.id': () => ({ value: 'session-options' }),
    'session.usage': () => ({ value: USAGE }),
    'session.start': (_$: any, e: any) => ({ cwd: e.cwd }),
    'fs.read': () => ({ value: 'ref: refs/heads/main\n' }),
    'config.list': () => ({ value: [] }),
    'command.register': (_$: any, e: any) => ({ value: { command: e.name } }),
    'ui.status': (_$: any, e: any) => { statuses.push(e.text); return { value: undefined } },
    'ui.invalidate': (_$: any, e: any, next: any) => { redraws.push(e.event); return next(e) },
    'ui.render': () => ({ type: 'Text', props: {}, children: ['engine hint'] }),
    'turn.step': async function* () { return { ...RESULT } },
    ...over,
  }
  for (const [event, fn] of Object.entries(mocks)) on(event as any, fn as any)
  return { clock, statuses, redraws }
}

export const start = ($: Engine) => $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work/demo' })
export async function step($: Engine, effort = 'max') {
  const stream = $.turn.step({ turnId: 'turn', index: 0, messageCount: 1, model: 'claude-haiku-4-5', effort } as any)
  for await (const _ of stream) { /* consume the engine response */ }
  return stream.result
}
