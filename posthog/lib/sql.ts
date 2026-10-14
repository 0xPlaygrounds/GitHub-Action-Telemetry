import { readFileSync } from 'node:fs'

// Install order: each view reads only views earlier in the list (or events).
export const VIEWS = [
  'ci_job_runs',
  'ci_step_runs',
  'ci_label_profile',
  'ci_label_speed',
  'ci_job_label_stats',
  'ci_job_sources',
  'ci_step_tradeoffs',
  'ci_job_tradeoffs'
]

export interface RenderOptions {
  windowDays: number
  baselineLabel: string
}

export function renderSql(
  text: string,
  { windowDays, baselineLabel }: RenderOptions
): string {
  if (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > 90) {
    throw new Error(`The window must be 1 to 90 days, not ${windowDays}`)
  }
  if (!/^[A-Za-z0-9._,-]+$/.test(baselineLabel)) {
    throw new Error(`The baseline label is not valid: ${baselineLabel}`)
  }
  return text
    .split('\n')
    .filter(line => !line.trim().startsWith('--'))
    .join('\n')
    .replaceAll('{{window_days}}', String(windowDays))
    .replaceAll('{{baseline_label}}', baselineLabel)
    .trim()
}

export function readView(name: string, options: RenderOptions): string {
  const path = new URL(`../sql/${name}.sql`, import.meta.url)
  return renderSql(readFileSync(path, 'utf8'), options)
}

export interface RawSql {
  sql: string
}

export function raw(sql: string): RawSql {
  return { sql }
}

export type LiteralValue = string | number | boolean | null | undefined | RawSql

function isRawSql(value: object): value is RawSql {
  return 'sql' in value
}

export function literal(value: LiteralValue): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'object' && isRawSql(value)) return value.sql
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return `'${String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`
}

export function fixture(columns: string[], rows: LiteralValue[][]): string {
  const tuples = rows.map(row => `tuple(${row.map(literal).join(', ')})`)
  const select = columns
    .map((column, index) => `t.${index + 1} AS ${column}`)
    .join(', ')
  return `SELECT ${select} FROM (SELECT arrayJoin([${tuples.join(', ')}]) AS t)`
}

export function withFixtures(
  sql: string,
  fixtures: Record<string, string>
): string {
  return Object.entries(fixtures).reduce(
    (text, [name, fixtureSql]) =>
      text.replace(
        new RegExp(`\\b(FROM|JOIN)\\s+${name}\\b`, 'g'),
        `$1 (${fixtureSql})`
      ),
    sql
  )
}
