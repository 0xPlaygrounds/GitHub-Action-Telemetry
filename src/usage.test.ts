import { describe, expect, it } from 'vitest'
import type { Sample, WorkflowJobType } from './interfaces/index.js'
import { MB, quantile, stepUsage, toIntervals, usage } from './usage.js'

const sample = (t: number, overrides: Partial<Sample> = {}): Sample => ({
  t,
  user: 0,
  system: 0,
  idle: 0,
  iowait: 0,
  mem_used: 0,
  swap_used: 0,
  load1: 0,
  disk_free: 0,
  disk_used: 0,
  disk_read: 0,
  disk_write: 0,
  net_rx: 0,
  net_tx: 0,
  ...overrides
})

describe('quantile', () => {
  it('uses the nearest rank, so p95 of 20 values is the 19th', () => {
    const values = Array.from({ length: 20 }, (_, index) => index + 1)
    expect(quantile(values, 0.95)).toBe(19)
    expect(quantile(values, 0.5)).toBe(10)
    expect(quantile([7], 0.95)).toBe(7)
    expect(quantile([], 0.95)).toBeNull()
  })
})

describe('toIntervals and usage', () => {
  it('turns counter differences into CPU percent, rates, and totals', () => {
    const samples = [
      sample(0),
      sample(5000, {
        user: 30,
        system: 10,
        idle: 50,
        iowait: 10,
        mem_used: 100 * MB,
        disk_write: 10 * MB,
        net_rx: 5 * MB
      })
    ]
    const intervals = toIntervals(samples)
    expect(intervals).toHaveLength(1)
    expect(intervals[0].cpu).toBe(40)
    expect(intervals[0].iowait).toBe(10)
    expect(intervals[0].seconds).toBe(5)
    const result = usage(intervals, 4)
    expect(result.cores_busy_avg).toBe(1.6)
    expect(result.mem_peak_mb).toBe(100)
    expect(result.disk_write_mb).toBe(10)
    expect(result.net_rx_mb).toBe(5)
  })
})

describe('stepUsage', () => {
  it('ends a step without completed_at at the next step start, and skips post steps', () => {
    const job = {
      steps: [
        {
          name: 'Build',
          started_at: '2026-01-01T00:00:00Z',
          completed_at: null
        },
        {
          name: 'Test',
          started_at: '2026-01-01T00:00:10Z',
          completed_at: '2026-01-01T00:00:20Z'
        },
        {
          name: 'Post Build',
          started_at: '2026-01-01T00:00:20Z',
          completed_at: '2026-01-01T00:00:21Z'
        }
      ]
    } as unknown as WorkflowJobType
    const start = Date.parse('2026-01-01T00:00:00Z')
    const samples = Array.from({ length: 5 }, (_, index) =>
      sample(start + index * 5000, { user: index * 10, idle: index * 10 })
    )
    const { steps, openSteps } = stepUsage(
      job,
      toIntervals(samples),
      2,
      start + 30_000
    )
    expect(openSteps).toEqual(['Build'])
    expect(steps.map(step => step.name)).toEqual(['Build', 'Test'])
    expect(steps[0].duration_s).toBe(10)
  })
})
