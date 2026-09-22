import type { On, PluginOptions } from 'claude-code'

const MARKER = 'touch DENY-ME'

let enabled = true
let strictness = 'block'
let calls = 0

export function register(on: On, options: PluginOptions) {
  enabled = options['hook_block_marker'] === true
  strictness = String(options['strictness'])

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const run = (await $.env.get('PROBE_RUN')) ?? 'run'

    await $.fs.write(
      $.plugin.root + '/out/' + run + '/guardmark.options.json',
      JSON.stringify({ options, enabled, strictness }),
    )

    return started
  })

  on('config.set', { key: 'guardmark.hook_block_marker' }, async ($, e, next) => {
    const result = await next(e)

    if (result.deny === undefined) enabled = result.value === true

    const run = (await $.env.get('PROBE_RUN')) ?? 'run'

    await $.fs.write(
      $.plugin.root + '/out/' + run + '/guardmark.config-set.json',
      JSON.stringify({
        key: e.key,
        value: e.value,
        previous: e.previous,
        origin: e.origin,
        provider: e.provider,
        result,
        enabledNow: enabled,
      }),
    )

    return result
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    calls += 1

    const command = (e as { command?: string }).command ?? ''
    const matched = command.startsWith(MARKER)
    const decision = enabled && matched && strictness === 'block' ? 'deny' : 'pass'
    const run = (await $.env.get('PROBE_RUN')) ?? 'run'

    await $.fs.write(
      $.plugin.root + '/out/' + run + '/guardmark.call-' + String(calls) + '.json',
      JSON.stringify({ command, enabled, strictness, matched, decision }),
    )

    if (decision === 'deny') return { deny: 'guardmark: the marker command is refused by your settings' }

    return next(e)
  })
}
