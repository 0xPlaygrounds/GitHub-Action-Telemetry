import { describe, expect, it } from 'vitest'
import { parse } from './procTraceParser.js'

const line = (name: string, startTimeNs: number, durationNs: number): string =>
  JSON.stringify({
    name,
    pid: 1,
    ppid: 0,
    startTimeNs,
    durationNs,
    exitCode: 0,
    args: [name]
  })

describe('parse', () => {
  const text = [
    line('cargo', 2e9, 5e9),
    line('cat', 1e9, 1e6),
    line('rustc', 1e9, 2e6),
    'not json'
  ].join('\n')

  it('drops system processes and short ones, and sorts by start', () => {
    const commands = parse(text, {
      minDurationMs: 1,
      traceSystemProcesses: false
    })
    expect(commands.map(command => command.name)).toEqual(['rustc', 'cargo'])
  })

  it('keeps system processes when asked', () => {
    const commands = parse(text, {
      minDurationMs: -1,
      traceSystemProcesses: true
    })
    expect(commands.map(command => command.name)).toEqual([
      'cat',
      'rustc',
      'cargo'
    ])
  })
})
