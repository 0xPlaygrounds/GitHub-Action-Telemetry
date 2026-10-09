import assert from 'node:assert/strict'

const host = process.env.POSTHOG_HOST ?? 'https://us.posthog.com'
const apiKey = process.env.POSTHOG_PERSONAL_API_KEY
const projectId = process.env.POSTHOG_PROJECT_ID

// Checks run only with a personal API key (scope query:read) and a project id; else they skip.
export const checkOptions = {
  skip:
    apiKey && projectId
      ? false
      : 'Set POSTHOG_PERSONAL_API_KEY and POSTHOG_PROJECT_ID to run the SQL checks'
}

export type Row = Record<string, string | number | boolean | null>

interface QueryResponse {
  results: unknown[][]
  columns: string[]
}

export async function runQuery(sql: string): Promise<Row[]> {
  const response = await fetch(`${host}/api/projects/${projectId}/query/`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query: sql } }),
    signal: AbortSignal.timeout(60_000)
  })
  const body: unknown = await response.json()
  if (!response.ok) {
    throw new Error(
      `Query failed with HTTP ${response.status}: ${JSON.stringify(body)}\n${sql}`
    )
  }
  const { results, columns } = body as QueryResponse
  return results.map(
    row =>
      Object.fromEntries(
        columns.map((column, index) => [column, row[index]])
      ) as Row
  )
}

const sortKey = (row: Row, keys: string[]): string =>
  keys.map(key => String(row[key])).join('\u0000')

export function assertRows(
  actual: Row[],
  expected: Row[],
  keys: string[]
): void {
  const sorted = (rows: Row[]): Row[] =>
    [...rows].sort((a, b) => sortKey(a, keys).localeCompare(sortKey(b, keys)))
  const left = sorted(actual)
  const right = sorted(expected)
  assert.equal(left.length, right.length, 'row count')
  right.forEach((row, index) => {
    for (const [column, value] of Object.entries(row)) {
      const got = left[index][column]
      const where = `${sortKey(row, keys)} ${column}`
      if (typeof value === 'number' && got !== null) {
        assert.ok(
          Math.abs(Number(got) - value) < 1e-6,
          `${where}: ${got} != ${value}`
        )
      } else if (typeof value === 'boolean') {
        assert.ok(
          got !== null && got !== undefined,
          `${where}: got NULL, expected ${value}`
        )
        assert.equal(Boolean(Number(got)), value, where)
      } else {
        assert.equal(got, value, where)
      }
    }
  })
}
