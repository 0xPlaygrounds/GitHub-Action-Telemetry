import { describe, expect, it } from 'vitest'
import { downsample, lineChart } from './charts.js'

describe('downsample', () => {
  it('keeps short series and averages long ones to the point limit', () => {
    expect(downsample([1, 2, 3], 5)).toEqual([1, 2, 3])
    expect(downsample([1, 3, 5, 7], 2)).toEqual([2, 6])
    expect(downsample(Array.from({ length: 600 }, () => 1))).toHaveLength(60)
  })
})

describe('lineChart', () => {
  it('writes one xychart line per series and names the colors in the title', () => {
    const chart = lineChart({
      title: 'Disk I/O MB/s',
      yLabel: 'MB/s',
      minutes: 2,
      series: [
        { name: 'read', color: 'blue', values: [1, 2] },
        { name: 'write', color: 'red', values: [3, 4] }
      ]
    })
    expect(chart).toContain('xychart-beta')
    expect(chart).toContain('title "Disk I/O MB/s: read (blue), write (red)"')
    expect(chart.match(/^ {2}line \[/gm)).toHaveLength(2)
  })

  it('returns nothing when no series has values', () => {
    expect(lineChart({ title: 'x', yLabel: 'y', minutes: 1, series: [] })).toBe(
      ''
    )
  })
})
