import { describe, expect, it } from 'vitest'
import {
  EMPTY_HINT,
  formatCost,
  formatDuration,
  formatPercent,
  frontier,
  percentChange,
  quote
} from '../canvas/runner-tradeoffs/src/view.js'

describe('quote', () => {
  it('escapes quotes and backslashes', () => {
    expect(quote("o/r' OR 1=1 --\\")).toBe("'o/r\\' OR 1=1 --\\\\'")
  })
})

describe('frontier', () => {
  it('keeps labels that no other label beats on both duration and cost', () => {
    const points = [
      { label: 'small', duration: 600, cost: 0.06 },
      { label: 'big', duration: 200, cost: 0.088 },
      { label: 'fast', duration: 450, cost: 0.064 },
      { label: 'slow', duration: 700, cost: 0.07 },
      { label: 'tiny', duration: null, cost: null }
    ]
    expect([...frontier(points)].sort()).toEqual(['big', 'fast', 'small'])
  })
})

describe('formatting', () => {
  it('formats durations, costs and changes', () => {
    expect(formatDuration(null)).toBe('—')
    expect(formatDuration(45.4)).toBe('45s')
    expect(formatDuration(316)).toBe('5m 16s')
    expect(formatCost(null)).toBe('no price')
    expect(formatCost(0.088)).toBe('$0.088')
    expect(percentChange(600, 450)).toBe(-0.25)
    expect(percentChange(0, 10)).toBe(null)
    expect(formatPercent(-0.25)).toBe('-25%')
    expect(formatPercent(0.5)).toBe('+50%')
    expect(formatPercent(null)).toBe('')
  })

  it('explains why a job can be missing', () => {
    expect(EMPTY_HINT).toMatch(/collect action/)
    expect(EMPTY_HINT).toMatch(/runner-benchmark/)
  })
})
