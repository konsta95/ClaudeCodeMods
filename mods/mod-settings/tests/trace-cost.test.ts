import { expect, mock, test } from 'claude-code/testing'

function quantiles(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return { median_ms: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2, p90_ms: sorted[Math.ceil(sorted.length * 0.9) - 1] }
}

test('trace timing instrument checks its quantiles against known inputs', () => {
  expect(quantiles([10, 9, 8, 7, 6, 5, 4, 3, 2, 1])).toEqual({ median_ms: 5.5, p90_ms: 9 })
  expect(quantiles([9, 1, 5])).toEqual({ median_ms: 5, p90_ms: 9 })
})

test('trace cost: wall time per kit dispatch with the pane closed and open', { timeoutMs: 30000 }, async ($, on) => {
  let traceReads = 0
  let traceWrites = 0
  on('store.*', async ($, e, next) => {
    if (next.is('store.get', e) && e.key === 'settings.traces.v1') traceReads++
    if (next.is('store.set', e) && e.key === 'settings.traces.v1') traceWrites++
    return next(e)
  })
  mock.store(on, { 'settings.interactive.v1': true })
  on('config.list', () => ({ value: [] }))
  on('tool.call', () => ({ deny: 'timing fixture; no process runs' }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('command.run', () => ({ text: 'no-trace baseline' }))
  const tool = () => $.tool.call({ tool: 'Bash', command: 'fixture', description: 'Timing fixture only' })

  for (const phase of ['closed', 'open']) {
    if (phase === 'open') await $.command.run({ command: 'mods', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
    for (let i = 0; i < 20; i++) await tool()
    const before = { reads: traceReads, writes: traceWrites }
    const samples: number[] = []
    for (let i = 0; i < 240; i++) {
      const started = performance.now()
      const result = await tool()
      samples.push(performance.now() - started)
      expect(result).toMatchObject({ deny: 'timing fixture; no process runs' })
    }
    expect(samples).toHaveLength(240)
    expect(samples.every(value => Number.isFinite(value) && value >= 0)).toBe(true)
    console.log('TRACE_COST ' + JSON.stringify({ phase, kind: 'tool.call', n: samples.length, ...quantiles(samples), samples_ms: samples }))
    console.log('TRACE_STORE ' + JSON.stringify({ phase, reads: traceReads - before.reads, writes: traceWrites - before.writes }))
  }
})
