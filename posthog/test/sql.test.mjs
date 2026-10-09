import { describe, expect, it } from 'vitest'
import {
  VIEWS,
  fixture,
  literal,
  raw,
  renderSql,
  withFixtures
} from '../lib/sql.mjs'

const options = { windowDays: 14, baselineLabel: 'ubuntu-latest' }

describe('renderSql', () => {
  it('fills the options and removes comment lines', () => {
    const sql = renderSql(
      "-- note\nSELECT {{window_days}} AS w, '{{baseline_label}}' AS b\n",
      options
    )
    expect(sql).toBe("SELECT 14 AS w, 'ubuntu-latest' AS b")
  })

  it('rejects a window outside 1..90 days', () => {
    expect(() => renderSql('', { ...options, windowDays: 0 })).toThrow(/window/)
    expect(() => renderSql('', { ...options, windowDays: 91 })).toThrow(
      /window/
    )
  })

  it('rejects a baseline label that could break the SQL', () => {
    expect(() =>
      renderSql('', { ...options, baselineLabel: "x' OR 1=1 --" })
    ).toThrow(/baseline/)
  })
})

describe('literal', () => {
  it('quotes strings and escapes quotes and backslashes', () => {
    expect(literal("it's a\\b")).toBe("'it\\'s a\\\\b'")
  })

  it('writes numbers, booleans, null and raw SQL as is', () => {
    expect(literal(1.5)).toBe('1.5')
    expect(literal(true)).toBe('true')
    expect(literal(null)).toBe('NULL')
    expect(literal(raw("toDateTime('2026-10-01 00:00:00')"))).toBe(
      "toDateTime('2026-10-01 00:00:00')"
    )
  })
})

describe('fixture', () => {
  it('builds a SELECT over an array of tuples', () => {
    expect(
      fixture(
        ['label', 'k'],
        [
          ['a', 1],
          ['b', null]
        ]
      )
    ).toBe(
      "SELECT t.1 AS label, t.2 AS k FROM (SELECT arrayJoin([tuple('a', 1), tuple('b', NULL)]) AS t)"
    )
  })
})

describe('withFixtures', () => {
  it('replaces views after FROM and JOIN only', () => {
    const sql =
      'SELECT 1 FROM ci_a AS a LEFT JOIN ci_b AS b ON a.x = b.x -- from ci_a'
    expect(
      withFixtures(sql, { ci_a: 'SELECT 1 AS x', ci_b: 'SELECT 2 AS x' })
    ).toBe(
      'SELECT 1 FROM (SELECT 1 AS x) AS a LEFT JOIN (SELECT 2 AS x) AS b ON a.x = b.x -- from ci_a'
    )
  })
})

describe('VIEWS', () => {
  it('lists the views in install order', () => {
    expect(VIEWS).toEqual([
      'ci_job_runs',
      'ci_step_runs',
      'ci_label_profile',
      'ci_label_speed',
      'ci_job_label_stats',
      'ci_job_sources',
      'ci_step_tradeoffs',
      'ci_job_tradeoffs'
    ])
  })
})
