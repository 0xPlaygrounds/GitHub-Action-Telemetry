# Runner Rightsizing in PostHog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show, for each CI job, its duration and cost on each runner label (measured or clearly labeled estimate) in PostHog saved views and a PostHog Desktop canvas, installed with one command.

**Architecture:** The action adds two event properties (`repo`, `job_key`). Eight saved HogQL views turn the events into per-label profiles, speed factors, per-step estimates and per-job trade-offs. Each view reads only other views, so each SQL file is checked alone with fixture rows through the PostHog query API. A canvas component reads three views and only formats. `posthog/install.mjs` upserts the views, the component and a grid canvas.

**Tech Stack:** TypeScript 6 + ncc (action), HogQL (views), Node 24 ESM `.mjs` (install, checks), vitest 5 (offline tests), `node:test` (API checks), React 19 + `@posthog/quill` + `recharts` (canvas).

**Spec:** `docs/superpowers/specs/2026-10-09-runner-rightsizing-design.md`

## Global Constraints

- Repository: fork `0xPlaygrounds/GitHub-Action-Telemetry`, clone at `/tmp/gat`, branch `rightsizing-spec` (base `origin/master`). Never open PRs against `catchpoint/workflow-telemetry-action`.
- Release version: `3.1.0`. Changes to events are additive only (`repo`, `job_key`).
- `npm run all` must pass after every task (format-check, lint, tsc, vitest, package). `dist/` and `collect/dist/` are committed and must match the source (`tests/verify-no-unstaged-changes.sh`).
- Prettier: no semicolons, single quotes, no trailing commas, 80 columns, `arrowParens: avoid`. Prettier checks `**/*.{ts,mjs}`.
- Code comments state current behavior and consequences. They never justify choices or describe alternatives. No comments that restate the code.
- HogQL rules: no width-suffixed casts (`toFloat`, `toInt`, `toFloatOrNull`, not `toFloat64`); no `SETTINGS`; no trailing semicolon; relational operators not allowed in `JOIN ... ON`; write SQL keywords in upper case; always alias a view in `FROM`/`JOIN` (`FROM ci_job_runs AS runs`).
- View names (exact): `ci_job_runs`, `ci_step_runs`, `ci_label_profile`, `ci_label_speed`, `ci_job_label_stats`, `ci_job_sources`, `ci_step_tradeoffs`, `ci_job_tradeoffs`.
- Install options: window `1..90` days (default `14`), baseline label matches `^[A-Za-z0-9._,-]+$` (default `ubuntu-latest`). Templates use `{{window_days}}` and `{{baseline_label}}`.
- Thresholds (exact): measured = `runs >= 3`; does not fit = `mem_peak_mb_p50 > 0.9 * mem_total_mb`; unreliable = `swap_peak_mb_max > 0 OR iowait_pct_p50 > 20`; calibration steps `cores_busy_avg <= 1.2` on both labels and baseline `duration_s >= 20`.
- Canvas: `canvasSdkVersion` and dependency pins come from `GET /canvases/:id/source/` when present; the fallback pins are `react 19.0.0`, `react-dom 19.0.0`, `@posthog/quill 0.3.0-beta.18`, `lucide-react 1.21.0`, `recharts 2.15.0`, SDK `0.2.0`. `ph` is a host global (never imported). Feature-detect `ph.state`. Component root uses `min-h-screen`.
- API scopes for the personal API key: `warehouse_view:read`, `warehouse_view:write`, `canvas:read`, `canvas:write`, `query:read`.
- SQL checks (`npm run test:posthog`) need env `POSTHOG_PERSONAL_API_KEY` and `POSTHOG_PROJECT_ID` (optional `POSTHOG_HOST`, default `https://us.posthog.com`). Without them, each check is skipped, not failed. They read no events except `ci_job_runs` with `LIMIT 0`, and write nothing.
- Outward-facing steps (push, PR, merge, release, install into a real project, monorepo push) need the user's confirmation at that moment.
- Commit trailer on every commit: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Conventional Commits.

## Review Focus

1. **Job with no step data** (API job lookup failed, so `steps` is `[]`): expect no estimate (null duration), not a copy of the source duration. Pinned by the `nosteps` case in Task 7.
2. **Measured p50 of 0 s** (a job that finishes in under a second): expect no backtest row, not a division by zero. Pinned by the `instant` case in Task 7.
3. **Repo, workflow, job or label names with quotes or backslashes** in canvas filters: expect a correct SQL string literal, never broken or injected SQL. Pinned by the `quote` test in Task 9.
4. **Duplicate events** (the collector runs twice for one run, or ingestion retries): expect one row per `job_id` in `ci_job_runs`. Fixture checks cannot feed `events`; pinned by the live check query in Task 11, step 4.
5. **Workflow not reported by `collect`** (no `ci_job` events): expect the job to be absent and the docs and empty state to say why. Pinned by the docs text in Task 10 and the empty-state text check in Task 9.

---

### Task 1: `repo` and `job_key` in the events (v3.1.0)

**Files:**
- Create: `src/identity.ts`, `src/identity.test.ts`, `docs/events.md`
- Modify: `src/post.ts` (imports, `properties` object near line 138), `src/collectEvents.ts:22-33` (`runContext`), `src/collectEvents.test.ts`, `action.yml` (inputs), `.github/workflows/self-test.yml` (jq check), `README.md` (inputs table), `CHANGELOG.md`, `package.json`, `package-lock.json`, `dist/`, `collect/dist/`

**Interfaces:**
- Produces: `jobIdentity(owner: string, repo: string, jobKeyInput: string, contextJob: string): { repo: string; job_key: string }` in `src/identity.ts`. Event properties `repo` (all three events) and `job_key` (`ci_job_resources`).

- [ ] **Step 1: Write the failing tests**

`src/identity.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { jobIdentity } from './identity.js'

describe('jobIdentity', () => {
  it('uses the job id of the workflow file when no key is set', () => {
    expect(jobIdentity('o', 'r', '', 'lint-and-test')).toEqual({
      repo: 'o/r',
      job_key: 'lint-and-test'
    })
  })

  it('uses the job_key input when it is set', () => {
    expect(jobIdentity('o', 'r', ' warm-clippy ', 'warm')).toEqual({
      repo: 'o/r',
      job_key: 'warm-clippy'
    })
  })
})
```

Add to `src/collectEvents.test.ts`, inside `describe('buildEvents', ...)`:

```ts
  it('adds the repository to job and run events', () => {
    const events = buildEvents(
      'o/r',
      run,
      [job(1, ['big'], '2026-01-01T00:00:00Z', '2026-01-01T00:01:01Z')],
      { big: 0.022 }
    )
    expect(events.map(event => event.properties.repo)).toEqual(['o/r', 'o/r'])
  })
```

- [ ] **Step 2: Run the tests to make sure they fail**

Run: `cd /tmp/gat && npx vitest run src/identity.test.ts src/collectEvents.test.ts`
Expected: FAIL — `Cannot find module './identity.js'` and `expected [ undefined, undefined ]`.

- [ ] **Step 3: Implement**

`src/identity.ts`:

```ts
// The job_key stays the same when a job runs on another runner label or is called from another
// workflow, so runs of one job can be compared. It defaults to the job's id in its workflow file.
export function jobIdentity(
  owner: string,
  repo: string,
  jobKeyInput: string,
  contextJob: string
): { repo: string; job_key: string } {
  return {
    repo: `${owner}/${repo}`,
    job_key: jobKeyInput.trim() || contextJob
  }
}
```

`src/post.ts`: add the import after the `./interfaces/index.js` import:

```ts
import { jobIdentity } from './identity.js'
```

and in the `properties` object, directly after `$process_person_profile: false,`:

```ts
    ...jobIdentity(
      github.context.repo.owner,
      github.context.repo.repo,
      core.getInput('job_key'),
      github.context.job
    ),
```

`src/collectEvents.ts`: in `runContext`, after `$process_person_profile: false,` add `repo,`.

`action.yml`: add after the `job_summary` input:

```yaml
  job_key:
    description: "Key that identifies this job across runner labels and calling workflows, so its runs can be compared. Defaults to the job's id in its workflow file (`github.job`). Set it when a matrix runs one job id with different work, for example `warm-clippy`."
    required: false
```

`README.md`: in the inputs table under `### Inputs`, add a row in the same format as the other rows: name `job_key`, description "Key that identifies this job across runner labels and calling workflows. Defaults to the job id in the workflow file (`github.job`). Set it for a matrix that runs different work under one job id.", default empty.

`.github/workflows/self-test.yml`: in the `jq -e` expression, after `.event == "ci_job_resources"` add:

```
            and .properties.job_key == "run-action"
            and .properties.repo == $ENV.GITHUB_REPOSITORY
```

`docs/events.md`:

````markdown
# Event contract

The action sends these events to PostHog. Property names and meanings are a public contract: a
change to them is a breaking change and needs a new major version. New properties can come in a
minor version. All events use `distinct_id: "ci"` and `$process_person_profile: false`, and a
deterministic `uuid`, so a second send of the same job does not add a second event.

## `ci_job_resources` (main action, one per job)

| Property | Meaning |
|---|---|
| `repo` | `owner/name` (since 3.1.0) |
| `job_key` | `job_key` input, else the job id in the workflow file (since 3.1.0) |
| `workflow`, `job`, `job_id`, `run_id`, `run_attempt` | GitHub identifiers; `job` is the job name from the API |
| `runner_label`, `runner_name` | Labels joined with `,`; runner machine name |
| `cpu_cores`, `cpu_model`, `arch`, `mem_total_mb`, `disk_total_gb` | Machine facts |
| `cpu_avg_pct`, `cpu_p95_pct`, `cores_busy_avg`, `cores_busy_p95` | CPU use over the job |
| `iowait_avg_pct`, `load1_max` | I/O wait and load |
| `mem_peak_mb`, `mem_peak_pct`, `swap_peak_mb` | Memory |
| `disk_read_mb`, `disk_write_mb`, `disk_read_mbps_p95`, `disk_write_mbps_p95`, `disk_free_min_gb` | Disk |
| `net_rx_mb`, `net_tx_mb` | Network |
| `sampled_s` | Seconds of samples |
| `sccache_hits`, `sccache_misses`, `sccache_hit_rate` | When sccache ran |
| `top_processes` | When `proc_trace_enable` is `true` |
| `steps[]` | `name`, `duration_s`, `cpu_avg_pct`, `cpu_p95_pct`, `cores_busy_avg`, `mem_peak_mb`, `disk_read_mb`, `disk_write_mb`, `net_rx_mb`, `net_tx_mb` |

## `ci_job` (`collect` action, one per job of the reported run)

| Property | Meaning |
|---|---|
| `repo` | `owner/name` (since 3.1.0) |
| `workflow`, `event`, `branch`, `sha`, `pr_number`, `run_id`, `run_attempt`, `run_url` | Run context; `event` is the trigger, for example `push` or `workflow_dispatch` |
| `job`, `job_id`, `conclusion`, `job_url` | Job |
| `runner_label`, `runner_group`, `runner_name` | Runner |
| `queued_s`, `duration_s` | Seconds |
| `billable_minutes`, `price_per_minute_usd`, `cost_usd` | Whole minutes and price from `runner_prices`; `cost_usd` is null when the label has no price |
| `steps[]` | `name`, `conclusion`, `duration_s` |

## `ci_run` (`collect` action, one per reported run)

| Property | Meaning |
|---|---|
| `repo` | `owner/name` (since 3.1.0) |
| Run context | Same as `ci_job` |
| `conclusion`, `duration_s`, `jobs`, `jobs_skipped`, `runner_minutes`, `billable_minutes`, `cost_usd` | Run totals |
````

`CHANGELOG.md`: add above `## 3.0.0`:

```markdown
## 3.1.0

### Added

- `repo` property (`owner/name`) on `ci_job_resources`, `ci_job` and `ci_run`.
- `job_key` input and property on `ci_job_resources`. It defaults to the job id in the workflow
  file, so runs of one job on different runner labels or from different calling workflows can be
  compared.
- `docs/events.md`: the event contract.
```

Version: `npm version 3.1.0 --no-git-tag-version`.

- [ ] **Step 4: Run all checks and rebuild `dist/`**

Run: `cd /tmp/gat && npm run format && npm run all && git status --short`
Expected: all pass; `dist/post/index.js`, `collect/dist/index.js` changed.

- [ ] **Step 5: Commit**

```bash
cd /tmp/gat && git add -A && git commit -m "$(cat <<'EOF'
feat: add repo and job_key to the events

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: SQL library (render, fixtures, view replacement) and check harness

**Files:**
- Create: `posthog/lib/sql.mjs`, `posthog/test/sql.test.mjs`, `posthog/checks/query.mjs`
- Modify: `package.json` (scripts), `eslint.config.mjs` (ignores)

**Interfaces:**
- Produces (from `posthog/lib/sql.mjs`):
  - `VIEWS: string[]` — the 8 view names in install order.
  - `renderSql(text: string, options: { windowDays: number, baselineLabel: string }): string` — validates options, replaces `{{window_days}}` and `{{baseline_label}}`, removes lines that start with `--`, trims.
  - `readView(name: string, options): string` — reads `posthog/sql/<name>.sql` and renders it.
  - `literal(value): string` — SQL literal for string, number, boolean, `null`, or `raw(...)`.
  - `raw(sql: string): { sql: string }` — marks a SQL expression to insert as is.
  - `fixture(columns: string[], rows: unknown[][]): string` — `SELECT t.1 AS c1, ... FROM (SELECT arrayJoin([tuple(...), ...]) AS t)`.
  - `withFixtures(sql: string, fixtures: Record<string, string>): string` — replaces `FROM name` / `JOIN name` with `FROM (fixture)` / `JOIN (fixture)`.
- Produces (from `posthog/checks/query.mjs`):
  - `checkOptions: { skip: false | string }` — `skip` is a reason string when env is missing.
  - `runQuery(sql: string): Promise<object[]>` — rows as objects keyed by column.
  - `assertRows(actual: object[], expected: object[], keys: string[]): void` — sorts both by `keys`, compares numbers with tolerance `1e-6`.

- [ ] **Step 1: Write the failing test**

`posthog/test/sql.test.mjs`:

```js
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
    expect(() => renderSql('', { ...options, windowDays: 0 })).toThrow(
      /window/
    )
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
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd /tmp/gat && npx vitest run posthog/test/sql.test.mjs`
Expected: FAIL — cannot find `../lib/sql.mjs`.

- [ ] **Step 3: Implement**

`posthog/lib/sql.mjs`:

```js
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

export function renderSql(text, { windowDays, baselineLabel }) {
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

export function readView(name, options) {
  const path = new URL(`../sql/${name}.sql`, import.meta.url)
  return renderSql(readFileSync(path, 'utf8'), options)
}

export function raw(sql) {
  return { sql }
}

export function literal(value) {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'object' && 'sql' in value) return value.sql
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return `'${String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`
}

export function fixture(columns, rows) {
  const tuples = rows.map(row => `tuple(${row.map(literal).join(', ')})`)
  const select = columns
    .map((column, index) => `t.${index + 1} AS ${column}`)
    .join(', ')
  return `SELECT ${select} FROM (SELECT arrayJoin([${tuples.join(', ')}]) AS t)`
}

export function withFixtures(sql, fixtures) {
  return Object.entries(fixtures).reduce(
    (text, [name, fixtureSql]) =>
      text.replace(
        new RegExp(`\\b(FROM|JOIN)\\s+${name}\\b`, 'g'),
        `$1 (${fixtureSql})`
      ),
    sql
  )
}
```

`posthog/checks/query.mjs`:

```js
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

export async function runQuery(sql) {
  const response = await fetch(`${host}/api/projects/${projectId}/query/`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query: sql } }),
    signal: AbortSignal.timeout(60_000)
  })
  const body = await response.json()
  if (!response.ok) {
    throw new Error(
      `Query failed with HTTP ${response.status}: ${JSON.stringify(body)}\n${sql}`
    )
  }
  return body.results.map(row =>
    Object.fromEntries(body.columns.map((column, index) => [column, row[index]]))
  )
}

const sortKey = (row, keys) => keys.map(key => String(row[key])).join('\u0000')

export function assertRows(actual, expected, keys) {
  const sorted = rows =>
    [...rows].sort((a, b) => sortKey(a, keys).localeCompare(sortKey(b, keys)))
  const left = sorted(actual)
  const right = sorted(expected)
  assert.equal(left.length, right.length, 'row count')
  right.forEach((row, index) => {
    for (const [column, value] of Object.entries(row)) {
      const got = left[index][column]
      const where = `${sortKey(row, keys)} ${column}`
      if (typeof value === 'number' && got !== null) {
        assert.ok(Math.abs(Number(got) - value) < 1e-6, `${where}: ${got} != ${value}`)
      } else if (typeof value === 'boolean') {
        assert.equal(Boolean(Number(got)), value, where)
      } else {
        assert.equal(got, value, where)
      }
    }
  })
}
```

`package.json` scripts: add `"test:posthog": "node --test \"posthog/checks/*.check.mjs\""`.

`eslint.config.mjs`: add `'posthog/canvas/'` to `ignores` (the canvas platform validates that code), and after the last entry add a block that turns off the TypeScript-only rule for JavaScript files:

```js
  {
    files: ['**/*.mjs'],
    rules: { '@typescript-eslint/explicit-function-return-type': 'off' }
  }
```

- [ ] **Step 4: Run the tests**

Run: `cd /tmp/gat && npx vitest run posthog/test/sql.test.mjs && npm run format && npm run all`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /tmp/gat && git add -A && git commit -m "$(cat <<'EOF'
feat(posthog): add SQL rendering, fixtures and the query check harness

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Views `ci_job_runs` and `ci_step_runs`

**Files:**
- Create: `posthog/sql/ci_job_runs.sql`, `posthog/sql/ci_step_runs.sql`, `posthog/checks/runs.check.mjs`

**Interfaces:**
- Consumes: `readView`, `fixture`, `withFixtures` (Task 2); `checkOptions`, `runQuery`, `assertRows` (Task 2).
- Produces: view `ci_job_runs` with columns `repo, job_key, workflow, job, job_id, run_id, runner_label, vcpus, mem_total_mb, cpu_model, mem_peak_mb, swap_peak_mb, iowait_avg_pct, steps_json, duration_s, queued_s, price_per_minute_usd, sha, trigger, completed_at`; view `ci_step_runs` with columns `repo, job_key, job_id, run_id, runner_label, sha, trigger, step_name, duration_s, cores_busy_avg`.

- [ ] **Step 1: Write the failing check**

`posthog/checks/runs.check.mjs`:

```js
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fixture, readView, withFixtures } from '../lib/sql.mjs'
import { assertRows, checkOptions, runQuery } from './query.mjs'

const options = { windowDays: 14, baselineLabel: 'small' }

test('ci_job_runs compiles against events', checkOptions, async () => {
  const sql = `SELECT * FROM (${readView('ci_job_runs', options)}) LIMIT 0`
  const response = await runQuery(sql)
  assert.deepEqual(response, [])
})

test('ci_step_runs gives one row for each step', checkOptions, async () => {
  const jobRuns = fixture(
    ['repo', 'job_key', 'job_id', 'run_id', 'runner_label', 'sha', 'trigger', 'steps_json'],
    [
      ['o/r', 'build', '1', '10', 'small', 'abc', 'push',
        '[{"name":"a","duration_s":12.5,"cores_busy_avg":1.5},{"name":"b","duration_s":3,"cores_busy_avg":null}]'],
      ['o/r', 'lint', '2', '10', 'small', 'abc', 'push', null]
    ]
  )
  const sql = withFixtures(readView('ci_step_runs', options), {
    ci_job_runs: jobRuns
  })
  assertRows(
    await runQuery(sql),
    [
      { job_key: 'build', step_name: 'a', duration_s: 12.5, cores_busy_avg: 1.5 },
      { job_key: 'build', step_name: 'b', duration_s: 3, cores_busy_avg: 0 }
    ],
    ['job_key', 'step_name']
  )
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd /tmp/gat && POSTHOG_PERSONAL_API_KEY=<key> POSTHOG_PROJECT_ID=<id> npm run test:posthog`
Expected: FAIL — `ENOENT ... posthog/sql/ci_job_runs.sql`.

- [ ] **Step 3: Write the views**

`posthog/sql/ci_job_runs.sql`:

```sql
-- One row for each successful job run that sent ci_job_resources, joined on job_id to its ci_job
-- event from the collect action. Duplicate events of a job collapse to one row. A job whose
-- workflow the collect action does not report has no ci_job event and is not in this view.
SELECT
    r.repo AS repo,
    r.job_key AS job_key,
    j.workflow AS workflow,
    r.job AS job,
    r.job_id AS job_id,
    j.run_id AS run_id,
    j.runner_label AS runner_label,
    r.vcpus AS vcpus,
    r.mem_total_mb AS mem_total_mb,
    r.cpu_model AS cpu_model,
    r.mem_peak_mb AS mem_peak_mb,
    r.swap_peak_mb AS swap_peak_mb,
    r.iowait_avg_pct AS iowait_avg_pct,
    r.steps_json AS steps_json,
    j.duration_s AS duration_s,
    j.queued_s AS queued_s,
    j.price_per_minute_usd AS price_per_minute_usd,
    j.sha AS sha,
    j.trigger AS trigger,
    j.completed_at AS completed_at
FROM (
    SELECT
        toString(properties.job_id) AS job_id,
        any(coalesce(properties.repo, '')) AS repo,
        any(coalesce(properties.job_key, properties.job)) AS job_key,
        any(properties.job) AS job,
        any(toInt(properties.cpu_cores)) AS vcpus,
        any(toFloat(properties.mem_total_mb)) AS mem_total_mb,
        any(properties.cpu_model) AS cpu_model,
        any(toFloat(properties.mem_peak_mb)) AS mem_peak_mb,
        any(ifNull(toFloat(properties.swap_peak_mb), 0)) AS swap_peak_mb,
        any(ifNull(toFloat(properties.iowait_avg_pct), 0)) AS iowait_avg_pct,
        any(toString(properties.steps)) AS steps_json
    FROM events
    WHERE event = 'ci_job_resources'
        AND timestamp > now() - INTERVAL {{window_days}} DAY
        AND properties.job_id IS NOT NULL
    GROUP BY job_id
) AS r
INNER JOIN (
    SELECT
        toString(properties.job_id) AS job_id,
        any(properties.workflow) AS workflow,
        any(toString(properties.run_id)) AS run_id,
        any(properties.runner_label) AS runner_label,
        any(toFloat(properties.duration_s)) AS duration_s,
        any(toFloat(properties.queued_s)) AS queued_s,
        any(toFloatOrNull(toString(properties.price_per_minute_usd))) AS price_per_minute_usd,
        any(properties.sha) AS sha,
        any(properties.event) AS trigger,
        max(timestamp) AS completed_at
    FROM events
    WHERE event = 'ci_job'
        AND timestamp > now() - INTERVAL {{window_days}} DAY
        AND properties.conclusion = 'success'
    GROUP BY job_id
) AS j ON r.job_id = j.job_id
```

`posthog/sql/ci_step_runs.sql`:

```sql
-- One row for each step of each job run. A step without CPU data has cores_busy_avg 0.
SELECT
    repo,
    job_key,
    job_id,
    run_id,
    runner_label,
    sha,
    trigger,
    JSONExtractString(step, 'name') AS step_name,
    JSONExtractFloat(step, 'duration_s') AS duration_s,
    JSONExtractFloat(step, 'cores_busy_avg') AS cores_busy_avg
FROM (
    SELECT
        repo,
        job_key,
        job_id,
        run_id,
        runner_label,
        sha,
        trigger,
        arrayJoin(JSONExtractArrayRaw(ifNull(steps_json, '[]'))) AS step
    FROM ci_job_runs AS runs
)
```

- [ ] **Step 4: Run the checks**

Run: `cd /tmp/gat && npm run format && POSTHOG_PERSONAL_API_KEY=<key> POSTHOG_PROJECT_ID=<id> npm run test:posthog && npm run all`
Expected: 2 checks pass. If HogQL rejects a function, fix the SQL with the HogQL hint in the error and run again.

- [ ] **Step 5: Commit**

```bash
cd /tmp/gat && git add -A && git commit -m "$(cat <<'EOF'
feat(posthog): add the job and step run views

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Views `ci_label_profile` and `ci_label_speed`

**Files:**
- Create: `posthog/sql/ci_label_profile.sql`, `posthog/sql/ci_label_speed.sql`, `posthog/checks/labels.check.mjs`

**Interfaces:**
- Consumes: `ci_job_runs`, `ci_step_runs` columns (Task 3); helpers (Task 2).
- Produces: `ci_label_profile(runner_label, vcpus, mem_total_mb, cpu_model, price_per_minute_usd, queued_s_p50, runs)`; `ci_label_speed(runner_label, k, pairs)`.

- [ ] **Step 1: Write the failing check**

`posthog/checks/labels.check.mjs`:

```js
import { test } from 'node:test'
import { fixture, raw, readView, withFixtures } from '../lib/sql.mjs'
import { assertRows, checkOptions, runQuery } from './query.mjs'

const options = { windowDays: 14, baselineLabel: 'small' }
const at = day => raw(`toDateTime('2026-10-0${day} 10:00:00')`)

test('ci_label_profile keeps the latest known price', checkOptions, async () => {
  const jobRuns = fixture(
    ['runner_label', 'vcpus', 'mem_total_mb', 'cpu_model', 'price_per_minute_usd', 'queued_s', 'completed_at'],
    [
      ['big', 8, 32000, 'EPYC', 0.022, 10, at(1)],
      ['big', 8, 32000, 'EPYC 2', null, 30, at(2)],
      ['small', 2, 8000, 'Xeon', 0.006, 5, at(1)]
    ]
  )
  const sql = withFixtures(readView('ci_label_profile', options), {
    ci_job_runs: jobRuns
  })
  assertRows(
    await runQuery(sql),
    [
      { runner_label: 'big', vcpus: 8, mem_total_mb: 32000, cpu_model: 'EPYC 2', price_per_minute_usd: 0.022, queued_s_p50: 20, runs: 2 },
      { runner_label: 'small', vcpus: 2, mem_total_mb: 8000, cpu_model: 'Xeon', price_per_minute_usd: 0.006, queued_s_p50: 5, runs: 1 }
    ],
    ['runner_label']
  )
})

test('ci_label_speed pairs single-threaded steps of one run', checkOptions, async () => {
  const stepRuns = fixture(
    ['repo', 'job_key', 'run_id', 'runner_label', 'step_name', 'duration_s', 'cores_busy_avg'],
    [
      ['o/r', 'build', '1', 'small', 'a', 100, 1.0],
      ['o/r', 'build', '1', 'big', 'a', 80, 1.0],
      ['o/r', 'build', '1', 'small', 'b', 50, 1.1],
      ['o/r', 'build', '1', 'big', 'b', 40, 1.0],
      ['o/r', 'build', '1', 'small', 'parallel', 300, 2.0],
      ['o/r', 'build', '1', 'big', 'parallel', 100, 6.0],
      ['o/r', 'build', '1', 'small', 'short', 10, 1.0],
      ['o/r', 'build', '1', 'big', 'short', 5, 1.0],
      ['o/r', 'build', '2', 'small', 'a', 100, 1.0],
      ['o/r', 'build', '2', 'big', 'a', 100, 1.0],
      ['o/r', 'build', '3', 'fast', 'a', 60, 1.0]
    ]
  )
  const sql = withFixtures(readView('ci_label_speed', options), {
    ci_step_runs: stepRuns
  })
  assertRows(
    await runQuery(sql),
    [
      { runner_label: 'big', k: 1.25, pairs: 3 },
      { runner_label: 'small', k: 1, pairs: 0 }
    ],
    ['runner_label']
  )
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd /tmp/gat && POSTHOG_PERSONAL_API_KEY=<key> POSTHOG_PROJECT_ID=<id> node --test posthog/checks/labels.check.mjs`
Expected: FAIL — `ENOENT ... ci_label_profile.sql`.

- [ ] **Step 3: Write the views**

`posthog/sql/ci_label_profile.sql`:

```sql
-- One row for each runner label seen in the window: machine size, the latest known price, and
-- the median queue time.
SELECT
    runner_label,
    max(vcpus) AS vcpus,
    max(mem_total_mb) AS mem_total_mb,
    argMax(cpu_model, completed_at) AS cpu_model,
    argMaxIf(price_per_minute_usd, completed_at, price_per_minute_usd IS NOT NULL) AS price_per_minute_usd,
    quantile(0.5)(queued_s) AS queued_s_p50,
    count() AS runs
FROM ci_job_runs AS runs
GROUP BY runner_label
```

`posthog/sql/ci_label_speed.sql`:

```sql
-- Per-core speed factor k of each runner label against the baseline label {{baseline_label}}
-- (k = 1). k is the median of baseline duration / label duration over single-threaded steps
-- (at most 1.2 busy cores on both labels, at least 20 s on the baseline) that ran on both labels
-- in the same run, as in a runner benchmark. A label without such steps has no row.
SELECT
    l.runner_label AS runner_label,
    quantile(0.5)(b.duration_s / l.duration_s) AS k,
    count() AS pairs
FROM ci_step_runs AS b
INNER JOIN ci_step_runs AS l
    ON b.repo = l.repo
    AND b.run_id = l.run_id
    AND b.job_key = l.job_key
    AND b.step_name = l.step_name
WHERE b.runner_label = '{{baseline_label}}'
    AND l.runner_label != '{{baseline_label}}'
    AND b.cores_busy_avg <= 1.2
    AND l.cores_busy_avg <= 1.2
    AND b.duration_s >= 20
    AND l.duration_s > 0
GROUP BY l.runner_label
UNION ALL
SELECT
    '{{baseline_label}}' AS runner_label,
    1.0 AS k,
    0 AS pairs
```

- [ ] **Step 4: Run the checks**

Run: `cd /tmp/gat && POSTHOG_PERSONAL_API_KEY=<key> POSTHOG_PROJECT_ID=<id> npm run test:posthog && npm run format && npm run all`
Expected: 4 checks pass.

- [ ] **Step 5: Commit**

```bash
cd /tmp/gat && git add -A && git commit -m "$(cat <<'EOF'
feat(posthog): add the label profile and speed factor views

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Views `ci_job_label_stats` and `ci_job_sources`

**Files:**
- Create: `posthog/sql/ci_job_label_stats.sql`, `posthog/sql/ci_job_sources.sql`, `posthog/checks/jobs.check.mjs`

**Interfaces:**
- Consumes: `ci_job_runs` (Task 3); helpers (Task 2).
- Produces: `ci_job_label_stats(repo, job_key, runner_label, workflow, runs, duration_p50_s, duration_p90_s, mem_peak_mb_p50, swap_peak_mb_max, iowait_pct_p50, normal_runs, last_normal_run_at)`; `ci_job_sources(repo, job_key, source_label, current_label, normal_runs, workflow)`. `current_label` is `''` for a job with no normal run.

- [ ] **Step 1: Write the failing check**

`posthog/checks/jobs.check.mjs`:

```js
import { test } from 'node:test'
import { fixture, raw, readView, withFixtures } from '../lib/sql.mjs'
import { assertRows, checkOptions, runQuery } from './query.mjs'

const options = { windowDays: 14, baselineLabel: 'small' }
const at = day => raw(`toDateTime('2026-10-0${day} 10:00:00')`)

test('ci_job_label_stats aggregates runs per job and label', checkOptions, async () => {
  const jobRuns = fixture(
    ['repo', 'job_key', 'runner_label', 'workflow', 'duration_s', 'mem_peak_mb', 'swap_peak_mb', 'iowait_avg_pct', 'trigger', 'completed_at'],
    [
      ['o/r', 'build', 'small', 'CI', 100, 1000, 0, 5, 'push', at(1)],
      ['o/r', 'build', 'small', 'CI', 200, 1200, 0, 7, 'pull_request', at(2)],
      ['o/r', 'build', 'small', 'CI', 300, 1400, 32, 9, 'push', at(3)],
      ['o/r', 'build', 'big', 'Runner benchmark', 50, 1100, 0, 4, 'workflow_dispatch', at(4)]
    ]
  )
  const sql = withFixtures(readView('ci_job_label_stats', options), {
    ci_job_runs: jobRuns
  })
  assertRows(
    await runQuery(sql),
    [
      { runner_label: 'big', workflow: 'Runner benchmark', runs: 1, duration_p50_s: 50, normal_runs: 0 },
      { runner_label: 'small', workflow: 'CI', runs: 3, duration_p50_s: 200, duration_p90_s: 280, mem_peak_mb_p50: 1200, swap_peak_mb_max: 32, iowait_pct_p50: 7, normal_runs: 3, last_normal_run_at: '2026-10-03T10:00:00Z' }
    ],
    ['runner_label']
  )
})

test('ci_job_sources picks the source and the current label', checkOptions, async () => {
  const stats = fixture(
    ['repo', 'job_key', 'runner_label', 'workflow', 'runs', 'normal_runs', 'last_normal_run_at'],
    [
      ['o/r', 'build', 'small', 'CI', 3, 3, at(3)],
      ['o/r', 'build', 'big', 'Runner benchmark', 3, 0, raw("toDateTime('1970-01-01 00:00:00')")],
      ['o/r', 'build', 'fast', 'CI fast', 1, 1, at(5)],
      ['o/r', 'bench', 'big', 'Runner benchmark', 2, 0, raw("toDateTime('1970-01-01 00:00:00')")]
    ]
  )
  const sql = withFixtures(readView('ci_job_sources', options), {
    ci_job_label_stats: stats
  })
  assertRows(
    await runQuery(sql),
    [
      { job_key: 'bench', source_label: 'big', current_label: '', normal_runs: 0, workflow: 'Runner benchmark' },
      { job_key: 'build', source_label: 'small', current_label: 'fast', normal_runs: 4, workflow: 'CI fast' }
    ],
    ['job_key']
  )
})
```

If the query API returns `last_normal_run_at` in another format (for example `2026-10-03 10:00:00`), change only the expected string to the format the API returns.

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd /tmp/gat && POSTHOG_PERSONAL_API_KEY=<key> POSTHOG_PROJECT_ID=<id> node --test posthog/checks/jobs.check.mjs`
Expected: FAIL — `ENOENT ... ci_job_label_stats.sql`.

- [ ] **Step 3: Write the views**

`posthog/sql/ci_job_label_stats.sql`:

```sql
-- One row for each job and runner label. Normal runs are runs not started by hand
-- (workflow_dispatch), such as push and pull_request runs. The workflow name comes from the
-- latest normal run, else from the latest run.
SELECT
    repo,
    job_key,
    runner_label,
    argMax(workflow, tuple(trigger != 'workflow_dispatch', completed_at)) AS workflow,
    count() AS runs,
    quantile(0.5)(duration_s) AS duration_p50_s,
    quantile(0.9)(duration_s) AS duration_p90_s,
    quantile(0.5)(mem_peak_mb) AS mem_peak_mb_p50,
    max(swap_peak_mb) AS swap_peak_mb_max,
    quantile(0.5)(iowait_avg_pct) AS iowait_pct_p50,
    countIf(trigger != 'workflow_dispatch') AS normal_runs,
    maxIf(completed_at, trigger != 'workflow_dispatch') AS last_normal_run_at
FROM ci_job_runs AS runs
GROUP BY repo, job_key, runner_label
```

`posthog/sql/ci_job_sources.sql`:

```sql
-- One row for each job. The source label (most runs; the later label name wins a tie) feeds the
-- estimates. The current label is the label of the last normal run, or '' when the job has no
-- normal run.
SELECT
    repo,
    job_key,
    argMax(runner_label, tuple(runs, runner_label)) AS source_label,
    argMaxIf(runner_label, last_normal_run_at, normal_runs > 0) AS current_label,
    sum(normal_runs) AS normal_runs,
    argMax(workflow, tuple(normal_runs > 0, last_normal_run_at)) AS workflow
FROM ci_job_label_stats AS stats
GROUP BY repo, job_key
```

- [ ] **Step 4: Run the checks**

Run: `cd /tmp/gat && POSTHOG_PERSONAL_API_KEY=<key> POSTHOG_PROJECT_ID=<id> npm run test:posthog && npm run format && npm run all`
Expected: 6 checks pass.

- [ ] **Step 5: Commit**

```bash
cd /tmp/gat && git add -A && git commit -m "$(cat <<'EOF'
feat(posthog): add the job label stats and job source views

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: View `ci_step_tradeoffs` (the formula)

**Files:**
- Create: `posthog/sql/ci_step_tradeoffs.sql`, `posthog/checks/steps.check.mjs`

**Interfaces:**
- Consumes: `ci_step_runs` (Task 3), `ci_label_profile`, `ci_label_speed` (Task 4), `ci_job_sources` (Task 5).
- Produces: `ci_step_tradeoffs(repo, job_key, step_name, source_label, target_label, t_s, c, w, p, estimate_s)`.

- [ ] **Step 1: Write the failing check**

`posthog/checks/steps.check.mjs`:

```js
import { test } from 'node:test'
import { fixture, readView, withFixtures } from '../lib/sql.mjs'
import { assertRows, checkOptions, runQuery } from './query.mjs'

const options = { windowDays: 14, baselineLabel: 'small' }

test('ci_step_tradeoffs applies the formula to each step', checkOptions, async () => {
  const stepRuns = fixture(
    ['repo', 'job_key', 'runner_label', 'step_name', 'duration_s', 'cores_busy_avg'],
    [
      ['o/r', 'build', 'small', 'net', 90, 0.2],
      ['o/r', 'build', 'small', 'net', 110, 0.2],
      ['o/r', 'build', 'small', 'single', 200, 1.0],
      ['o/r', 'build', 'small', 'parallel', 300, 2.0],
      ['o/r', 'build', 'big', 'single', 150, 1.0]
    ]
  )
  const sources = fixture(
    ['repo', 'job_key', 'source_label'],
    [['o/r', 'build', 'small']]
  )
  const profile = fixture(
    ['runner_label', 'vcpus'],
    [
      ['small', 2],
      ['big', 8],
      ['fast', 4]
    ]
  )
  const speed = fixture(
    ['runner_label', 'k'],
    [
      ['small', 1.0],
      ['big', 1.25]
    ]
  )
  const sql = withFixtures(readView('ci_step_tradeoffs', options), {
    ci_step_runs: stepRuns,
    ci_job_sources: sources,
    ci_label_profile: profile,
    ci_label_speed: speed
  })
  // net: w 0.8, p 0; single: w 0, p 0; parallel: w 0, p 1 (2 busy cores on 2 vCPUs).
  assertRows(
    await runQuery(sql),
    [
      { step_name: 'net', target_label: 'big', t_s: 100, w: 0.8, p: 0, estimate_s: 96 },
      { step_name: 'net', target_label: 'fast', t_s: 100, estimate_s: 100 },
      { step_name: 'net', target_label: 'small', t_s: 100, estimate_s: 100 },
      { step_name: 'parallel', target_label: 'big', t_s: 300, w: 0, p: 1, estimate_s: 60 },
      { step_name: 'parallel', target_label: 'fast', t_s: 300, estimate_s: 150 },
      { step_name: 'parallel', target_label: 'small', t_s: 300, estimate_s: 300 },
      { step_name: 'single', target_label: 'big', t_s: 200, w: 0, p: 0, estimate_s: 160 },
      { step_name: 'single', target_label: 'fast', t_s: 200, estimate_s: 200 },
      { step_name: 'single', target_label: 'small', t_s: 200, estimate_s: 200 }
    ],
    ['step_name', 'target_label']
  )
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd /tmp/gat && POSTHOG_PERSONAL_API_KEY=<key> POSTHOG_PROJECT_ID=<id> node --test posthog/checks/steps.check.mjs`
Expected: FAIL — `ENOENT ... ci_step_tradeoffs.sql`.

- [ ] **Step 3: Write the view**

`posthog/sql/ci_step_tradeoffs.sql`:

```sql
-- Estimated duration of each step of a job on each runner label, from the step's median duration
-- t and median busy cores c on the job's source label:
--   w  = max(0, 1 - c)                    share of time with no CPU work
--   p  = clamp((c - 1) / (Ns - 1), 0, 1)  parallel share
--   t' = t * (w + (1 - w) * ((1 - p) + p * Ns / Nt) * ks / kt)
-- Ns and Nt are the vCPUs of the source and target labels, ks and kt their speed factors. A label
-- without a speed factor uses k = 1.
WITH steps AS (
    SELECT
        repo,
        job_key,
        runner_label,
        step_name,
        quantile(0.5)(duration_s) AS t_s,
        quantile(0.5)(cores_busy_avg) AS c
    FROM ci_step_runs AS step_runs
    GROUP BY repo, job_key, runner_label, step_name
),
labels AS (
    SELECT
        profile.runner_label AS runner_label,
        profile.vcpus AS vcpus,
        nullIf(speed.k, 0) AS k
    FROM ci_label_profile AS profile
    LEFT JOIN ci_label_speed AS speed ON profile.runner_label = speed.runner_label
),
factors AS (
    SELECT
        steps.repo AS repo,
        steps.job_key AS job_key,
        steps.step_name AS step_name,
        sources.source_label AS source_label,
        tgt_label.runner_label AS target_label,
        steps.t_s AS t_s,
        steps.c AS c,
        greatest(0, 1 - steps.c) AS w,
        if(src_label.vcpus > 1, least(1, greatest(0, (steps.c - 1) / (src_label.vcpus - 1))), 0) AS p,
        src_label.vcpus AS source_vcpus,
        tgt_label.vcpus AS target_vcpus,
        ifNull(src_label.k, 1.0) AS source_k,
        ifNull(tgt_label.k, 1.0) AS target_k
    FROM steps
    INNER JOIN ci_job_sources AS sources
        ON steps.repo = sources.repo
        AND steps.job_key = sources.job_key
        AND steps.runner_label = sources.source_label
    INNER JOIN labels AS src_label ON src_label.runner_label = sources.source_label
    CROSS JOIN labels AS tgt_label
)
SELECT
    repo,
    job_key,
    step_name,
    source_label,
    target_label,
    t_s,
    c,
    w,
    p,
    t_s * (w + (1 - w) * ((1 - p) + p * source_vcpus / target_vcpus) * source_k / target_k) AS estimate_s
FROM factors
```

- [ ] **Step 4: Run the checks**

Run: `cd /tmp/gat && POSTHOG_PERSONAL_API_KEY=<key> POSTHOG_PROJECT_ID=<id> npm run test:posthog && npm run format && npm run all`
Expected: 7 checks pass.

- [ ] **Step 5: Commit**

```bash
cd /tmp/gat && git add -A && git commit -m "$(cat <<'EOF'
feat(posthog): add the per-step estimate view

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: View `ci_job_tradeoffs` (the rules and the backtest)

**Files:**
- Create: `posthog/sql/ci_job_tradeoffs.sql`, `posthog/checks/tradeoffs.check.mjs`

**Interfaces:**
- Consumes: `ci_label_profile`, `ci_label_speed` (Task 4), `ci_job_label_stats`, `ci_job_sources` (Task 5), `ci_step_tradeoffs` (Task 6).
- Produces: `ci_job_tradeoffs(repo, workflow, job_key, runner_label, source_label, is_current_label, runs, source, duration_p50_s, duration_p90_s, cost_per_run_usd, unreliable, queued_s_p50, runs_per_month, backtest_estimate_s, backtest_error, backtest_kind)`.

- [ ] **Step 1: Write the failing check**

`posthog/checks/tradeoffs.check.mjs`:

```js
import { test } from 'node:test'
import { fixture, readView, withFixtures } from '../lib/sql.mjs'
import { assertRows, checkOptions, runQuery } from './query.mjs'

const options = { windowDays: 14, baselineLabel: 'small' }

const fixtures = {
  ci_label_profile: fixture(
    ['runner_label', 'mem_total_mb', 'price_per_minute_usd', 'queued_s_p50'],
    [
      ['small', 8000, 0.006, 5],
      ['big', 32000, 0.022, 30],
      ['fast', 16000, 0.008, 2],
      ['tiny', 1000, null, 1]
    ]
  ),
  ci_label_speed: fixture(
    ['runner_label', 'k'],
    [
      ['small', 1.0],
      ['big', 1.25]
    ]
  ),
  ci_job_label_stats: fixture(
    ['repo', 'job_key', 'runner_label', 'runs', 'duration_p50_s', 'duration_p90_s', 'mem_peak_mb_p50', 'swap_peak_mb_max', 'iowait_pct_p50'],
    [
      ['o/r', 'build', 'small', 10, 600, 700, 2000, 0, 5],
      ['o/r', 'build', 'big', 3, 200, 220, 2100, 0, 4],
      ['o/r', 'lint', 'small', 2, 120, 130, 500, 64, 3],
      ['o/r', 'nosteps', 'small', 5, 90, 95, 100, 0, 1],
      ['o/r', 'instant', 'small', 5, 10, 12, 100, 0, 1],
      ['o/r', 'instant', 'big', 3, 0, 0, 100, 0, 1]
    ]
  ),
  ci_job_sources: fixture(
    ['repo', 'job_key', 'workflow', 'source_label', 'current_label', 'normal_runs'],
    [
      ['o/r', 'build', 'CI', 'small', 'small', 10],
      ['o/r', 'lint', 'CI', 'small', 'small', 2],
      ['o/r', 'nosteps', 'CI', 'small', 'small', 5],
      ['o/r', 'instant', 'CI', 'small', 'small', 5]
    ]
  ),
  ci_step_tradeoffs: fixture(
    ['repo', 'job_key', 'target_label', 't_s', 'estimate_s'],
    [
      ['o/r', 'build', 'small', 600, 600],
      ['o/r', 'build', 'big', 600, 316],
      ['o/r', 'build', 'fast', 600, 450],
      ['o/r', 'build', 'tiny', 600, 600],
      ['o/r', 'lint', 'small', 100, 100],
      ['o/r', 'lint', 'big', 100, 80],
      ['o/r', 'lint', 'fast', 100, 100],
      ['o/r', 'lint', 'tiny', 100, 100],
      ['o/r', 'instant', 'small', 10, 10],
      ['o/r', 'instant', 'big', 10, 8],
      ['o/r', 'instant', 'fast', 10, 10],
      ['o/r', 'instant', 'tiny', 10, 10]
    ]
  )
}

test('ci_job_tradeoffs applies the rules', checkOptions, async () => {
  const sql = withFixtures(readView('ci_job_tradeoffs', options), fixtures)
  const rows = await runQuery(sql)
  assertRows(
    rows.filter(row => row.job_key !== 'instant'),
    [
      { job_key: 'build', runner_label: 'big', source: 'measured', duration_p50_s: 200, duration_p90_s: 220, cost_per_run_usd: 0.088, unreliable: false, backtest_estimate_s: 316, backtest_error: 0.58, backtest_kind: 'calibrated' },
      { job_key: 'build', runner_label: 'fast', source: 'uncalibrated', duration_p50_s: 450, duration_p90_s: null, cost_per_run_usd: 0.064, unreliable: false, backtest_kind: null },
      { job_key: 'build', runner_label: 'small', source: 'measured', is_current_label: true, duration_p50_s: 600, cost_per_run_usd: 0.06, runs_per_month: 300 / 14, backtest_kind: null },
      { job_key: 'build', runner_label: 'tiny', source: 'does_not_fit', duration_p50_s: null, cost_per_run_usd: null },
      { job_key: 'lint', runner_label: 'big', source: 'calibrated', duration_p50_s: 100, cost_per_run_usd: 0.044, unreliable: true },
      { job_key: 'lint', runner_label: 'fast', source: 'uncalibrated', duration_p50_s: 120, unreliable: true },
      { job_key: 'lint', runner_label: 'small', source: 'calibrated', duration_p50_s: 120, cost_per_run_usd: 0.012, unreliable: true },
      { job_key: 'lint', runner_label: 'tiny', source: 'uncalibrated', duration_p50_s: 120, cost_per_run_usd: null, unreliable: true },
      { job_key: 'nosteps', runner_label: 'big', source: 'calibrated', duration_p50_s: null },
      { job_key: 'nosteps', runner_label: 'fast', source: 'uncalibrated', duration_p50_s: null },
      { job_key: 'nosteps', runner_label: 'small', source: 'measured', duration_p50_s: 90 },
      { job_key: 'nosteps', runner_label: 'tiny', source: 'uncalibrated', duration_p50_s: null }
    ],
    ['job_key', 'runner_label']
  )
})

test('ci_job_tradeoffs gives no backtest for a measured p50 of 0', checkOptions, async () => {
  const sql = withFixtures(readView('ci_job_tradeoffs', options), fixtures)
  const rows = await runQuery(sql)
  assertRows(
    rows.filter(row => row.job_key === 'instant' && row.runner_label === 'big'),
    [{ job_key: 'instant', runner_label: 'big', source: 'measured', backtest_error: null, backtest_kind: null }],
    ['job_key', 'runner_label']
  )
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd /tmp/gat && POSTHOG_PERSONAL_API_KEY=<key> POSTHOG_PROJECT_ID=<id> node --test posthog/checks/tradeoffs.check.mjs`
Expected: FAIL — `ENOENT ... ci_job_tradeoffs.sql`.

- [ ] **Step 3: Write the view**

`posthog/sql/ci_job_tradeoffs.sql`:

```sql
-- One row for each job and runner label, with the duration and cost to show and their source:
--   measured      3 or more successful runs on the label
--   does_not_fit  the median peak memory on the source label is above 90% of the label's memory
--   calibrated    the source and target labels both have a speed factor
--   uncalibrated  one of them has no speed factor
-- An estimate is the source label's median job duration plus the step changes of
-- ci_step_tradeoffs; a job with no step data has no estimate. Estimates are unreliable when the
-- source runs used swap or had more than 20% I/O wait. Measured labels other than the source
-- label, with a measured p50 above 0, also get the estimate as a backtest.
WITH labels AS (
    SELECT
        profile.runner_label AS runner_label,
        profile.mem_total_mb AS mem_total_mb,
        profile.price_per_minute_usd AS price_per_minute_usd,
        profile.queued_s_p50 AS queued_s_p50,
        nullIf(speed.k, 0) AS k
    FROM ci_label_profile AS profile
    LEFT JOIN ci_label_speed AS speed ON profile.runner_label = speed.runner_label
),
deltas AS (
    SELECT
        repo,
        job_key,
        target_label,
        sum(estimate_s - t_s) AS delta_s,
        count() AS steps
    FROM ci_step_tradeoffs AS step_tradeoffs
    GROUP BY repo, job_key, target_label
),
pairs AS (
    SELECT
        sources.repo AS repo,
        sources.workflow AS workflow,
        sources.job_key AS job_key,
        tgt_label.runner_label AS runner_label,
        sources.source_label AS source_label,
        tgt_label.runner_label = sources.current_label AS is_current_label,
        ifNull(target_stats.runs, 0) AS runs,
        target_stats.duration_p50_s AS measured_p50_s,
        target_stats.duration_p90_s AS measured_p90_s,
        if(ifNull(deltas.steps, 0) > 0, source_stats.duration_p50_s + deltas.delta_s, NULL) AS estimate_s,
        source_stats.mem_peak_mb_p50 > 0.9 * tgt_label.mem_total_mb AS too_big,
        src_label.k IS NOT NULL AND tgt_label.k IS NOT NULL AS calibrated,
        source_stats.swap_peak_mb_max > 0 OR source_stats.iowait_pct_p50 > 20 AS strained,
        tgt_label.price_per_minute_usd AS price_per_minute_usd,
        tgt_label.queued_s_p50 AS queued_s_p50,
        sources.normal_runs * 30 / {{window_days}} AS runs_per_month
    FROM ci_job_sources AS sources
    INNER JOIN ci_job_label_stats AS source_stats
        ON source_stats.repo = sources.repo
        AND source_stats.job_key = sources.job_key
        AND source_stats.runner_label = sources.source_label
    INNER JOIN labels AS src_label ON src_label.runner_label = sources.source_label
    CROSS JOIN labels AS tgt_label
    LEFT JOIN ci_job_label_stats AS target_stats
        ON target_stats.repo = sources.repo
        AND target_stats.job_key = sources.job_key
        AND target_stats.runner_label = tgt_label.runner_label
    LEFT JOIN deltas
        ON deltas.repo = sources.repo
        AND deltas.job_key = sources.job_key
        AND deltas.target_label = tgt_label.runner_label
),
ruled AS (
    SELECT
        *,
        multiIf(
            runs >= 3, 'measured',
            too_big, 'does_not_fit',
            calibrated, 'calibrated',
            'uncalibrated'
        ) AS source,
        runs >= 3 AND runner_label != source_label AND measured_p50_s > 0 AS backtested
    FROM pairs
)
SELECT
    repo,
    workflow,
    job_key,
    runner_label,
    source_label,
    is_current_label,
    runs,
    source,
    multiIf(source = 'measured', measured_p50_s, source = 'does_not_fit', NULL, estimate_s) AS duration_p50_s,
    if(source = 'measured', measured_p90_s, NULL) AS duration_p90_s,
    ceil(multiIf(source = 'measured', measured_p50_s, source = 'does_not_fit', NULL, estimate_s) / 60) * price_per_minute_usd AS cost_per_run_usd,
    source IN ('calibrated', 'uncalibrated') AND strained AS unreliable,
    queued_s_p50,
    runs_per_month,
    if(backtested, estimate_s, NULL) AS backtest_estimate_s,
    if(backtested, (estimate_s - measured_p50_s) / measured_p50_s, NULL) AS backtest_error,
    if(backtested, if(calibrated, 'calibrated', 'uncalibrated'), NULL) AS backtest_kind
FROM ruled
```

- [ ] **Step 4: Run the checks**

Run: `cd /tmp/gat && POSTHOG_PERSONAL_API_KEY=<key> POSTHOG_PROJECT_ID=<id> npm run test:posthog && npm run format && npm run all`
Expected: 9 checks pass. If HogQL rejects `SELECT *, ...` in `ruled`, list the columns of `pairs` by name.

- [ ] **Step 5: Commit**

```bash
cd /tmp/gat && git add -A && git commit -m "$(cat <<'EOF'
feat(posthog): add the job trade-off view with rules and backtest

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: API client and view install

**Files:**
- Create: `posthog/lib/api.mjs`, `posthog/lib/install.mjs`, `posthog/install.mjs`, `posthog/test/install.test.mjs`

**Interfaces:**
- Consumes: `VIEWS`, `readView` (Task 2).
- Produces:
  - `createApi({ host, projectId, apiKey, fetchImpl? }): { get(path), post(path, body), patch(path, body) }` — paths relative to `/api/projects/<id>`; throws `Error` with status and body text on non-2xx.
  - `upsertView(api, name, sql): Promise<'created' | 'updated' | 'unchanged'>`.
  - `installViews(api, options, log = console.log): Promise<void>`.

- [ ] **Step 1: Write the failing test**

`posthog/test/install.test.mjs`:

```js
import { describe, expect, it } from 'vitest'
import { upsertView } from '../lib/install.mjs'

function fakeApi(existing) {
  const calls = []
  return {
    calls,
    get: async path => {
      calls.push(['GET', path])
      return { results: existing }
    },
    post: async (path, body) => {
      calls.push(['POST', path, body])
      return { id: 'new' }
    },
    patch: async (path, body) => {
      calls.push(['PATCH', path, body])
      return {}
    }
  }
}

describe('upsertView', () => {
  it('creates a view that does not exist', async () => {
    const api = fakeApi([{ id: 'x', name: 'ci_job_runs_old', query: {} }])
    expect(await upsertView(api, 'ci_job_runs', 'SELECT 1')).toBe('created')
    expect(api.calls.at(-1)).toEqual([
      'POST',
      '/warehouse_saved_queries/',
      { name: 'ci_job_runs', query: { kind: 'HogQLQuery', query: 'SELECT 1' } }
    ])
  })

  it('updates a view whose SQL changed', async () => {
    const api = fakeApi([
      { id: 'v1', name: 'ci_job_runs', query: { query: 'SELECT 0' } }
    ])
    expect(await upsertView(api, 'ci_job_runs', 'SELECT 1')).toBe('updated')
    expect(api.calls.at(-1)).toEqual([
      'PATCH',
      '/warehouse_saved_queries/v1/',
      { query: { kind: 'HogQLQuery', query: 'SELECT 1' } }
    ])
  })

  it('leaves a view with the same SQL unchanged', async () => {
    const api = fakeApi([
      { id: 'v1', name: 'ci_job_runs', query: { query: 'SELECT 1' } }
    ])
    expect(await upsertView(api, 'ci_job_runs', 'SELECT 1')).toBe('unchanged')
    expect(api.calls).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd /tmp/gat && npx vitest run posthog/test/install.test.mjs`
Expected: FAIL — cannot find `../lib/install.mjs`.

- [ ] **Step 3: Implement**

`posthog/lib/api.mjs`:

```js
export function createApi({ host, projectId, apiKey, fetchImpl = fetch }) {
  async function request(method, path, body) {
    const response = await fetchImpl(
      `${host}/api/projects/${projectId}${path}`,
      {
        method,
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json'
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(60_000)
      }
    )
    const text = await response.text()
    if (!response.ok) {
      throw new Error(`${method} ${path} returned HTTP ${response.status}: ${text}`)
    }
    return text ? JSON.parse(text) : null
  }
  return {
    get: async path => request('GET', path),
    post: async (path, body) => request('POST', path, body),
    patch: async (path, body) => request('PATCH', path, body)
  }
}
```

`posthog/lib/install.mjs`:

```js
import { VIEWS, readView } from './sql.mjs'

export async function upsertView(api, name, sql) {
  const list = await api.get(
    `/warehouse_saved_queries/?search=${encodeURIComponent(name)}`
  )
  const existing = (list.results ?? []).find(view => view.name === name)
  const query = { kind: 'HogQLQuery', query: sql }
  if (!existing) {
    await api.post('/warehouse_saved_queries/', { name, query })
    return 'created'
  }
  if (existing.query?.query === sql) return 'unchanged'
  await api.patch(`/warehouse_saved_queries/${existing.id}/`, { query })
  return 'updated'
}

export async function installViews(api, options, log = console.log) {
  for (const name of VIEWS) {
    log(`${name}: ${await upsertView(api, name, readView(name, options))}`)
  }
}
```

`posthog/install.mjs`:

```js
#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { createApi } from './lib/api.mjs'
import { installViews } from './lib/install.mjs'

const { values } = parseArgs({
  options: {
    project: { type: 'string' },
    channel: { type: 'string' },
    'window-days': { type: 'string', default: '14' },
    baseline: { type: 'string', default: 'ubuntu-latest' }
  }
})
const apiKey = process.env.POSTHOG_PERSONAL_API_KEY
if (!values.project || !apiKey) {
  console.error(
    'Usage: POSTHOG_PERSONAL_API_KEY=... node posthog/install.mjs --project <id> ' +
      '[--channel <id>] [--window-days 14] [--baseline ubuntu-latest]'
  )
  process.exit(1)
}

const api = createApi({
  host: process.env.POSTHOG_HOST ?? 'https://us.posthog.com',
  projectId: values.project,
  apiKey
})
const options = {
  windowDays: Number(values['window-days']),
  baselineLabel: values.baseline
}
await installViews(api, options)
if (!values.channel) {
  console.log('No --channel: the views are installed, the canvas is not.')
}
```

- [ ] **Step 4: Run the tests**

Run: `cd /tmp/gat && npx vitest run posthog/test/install.test.mjs && npm run format && npm run all`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /tmp/gat && git add -A && git commit -m "$(cat <<'EOF'
feat(posthog): add the install script for the views

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Canvas component and canvas install

**Files:**
- Create: `posthog/canvas/runner-tradeoffs/src/view.js`, `posthog/canvas/runner-tradeoffs/src/canvas.tsx`, `posthog/test/view.test.mjs`
- Modify: `posthog/lib/install.mjs` (add canvas functions), `posthog/install.mjs` (call them), `posthog/test/install.test.mjs`

**Interfaces:**
- Consumes: views `ci_label_profile`, `ci_job_tradeoffs`, `ci_step_tradeoffs` (Tasks 4, 6, 7); `createApi` (Task 8).
- Produces:
  - `view.js`: `quote(value): string`, `percentChange(from, to): number | null`, `frontier(points: {label, duration, cost}[]): Set<string>`, `formatDuration(seconds): string`, `formatCost(usd): string`, `formatPercent(fraction): string`, `EMPTY_HINT: string`.
  - `install.mjs`: `componentProject(base, settings): object`, `upsertComponent(api, { channelId, settings }): Promise<string>` (component id), `ensureGrid(api, { channelId, componentId }): Promise<'created' | 'unchanged'>`.

- [ ] **Step 1: Write the failing tests**

`posthog/test/view.test.mjs`:

```js
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
```

In `posthog/test/install.test.mjs`, change the import at the top to
`import { componentProject, ensureGrid, upsertView } from '../lib/install.mjs'` and add:

```js
describe('componentProject', () => {
  it('keeps the shell and pins of the canvas and adds the component files', () => {
    const project = componentProject(
      {
        project: {
          entryHtml: 'index.html',
          files: { 'index.html': '<shell>' },
          dependencies: { react: '19.1.0', three: '0.179.1' },
          canvasSdkVersion: '0.2.0'
        }
      },
      { windowDays: 14, baselineLabel: 'ubuntu-latest' }
    )
    expect(project.files['index.html']).toBe('<shell>')
    expect(project.files['src/settings.js']).toBe(
      "export const WINDOW_DAYS = 14\nexport const BASELINE_LABEL = 'ubuntu-latest'\n"
    )
    expect(Object.keys(project.files).sort()).toEqual([
      'index.html',
      'src/canvas.tsx',
      'src/settings.js',
      'src/view.js'
    ])
    expect(project.dependencies).toEqual({
      react: '19.1.0',
      'react-dom': '19.0.0',
      '@posthog/quill': '0.3.0-beta.18',
      'lucide-react': '1.21.0',
      recharts: '2.15.0'
    })
    expect(project.capabilities.posthog).toEqual({
      insights: [],
      inlineQueries: true,
      captureEvents: [],
      state: ['user'],
      actions: []
    })
    expect(project.component.configSchema.properties).toHaveProperty('repo')
  })
})

describe('ensureGrid', () => {
  it('leaves a grid that already has the placement unchanged', async () => {
    const calls = []
    const api = {
      get: async path => {
        calls.push(['GET', path])
        if (path.startsWith('/canvases/?')) {
          return { results: [{ id: 'g1', name: 'CI runners', kind: 'grid' }] }
        }
        return {
          current_version_id: 'v1',
          layout: { placements: [{ id: 'runner-tradeoffs' }] }
        }
      },
      post: async (path, body) => {
        calls.push(['POST', path, body])
        return {}
      }
    }
    expect(await ensureGrid(api, { channelId: 'c1', componentId: 'k1' })).toBe(
      'unchanged'
    )
    expect(calls.filter(call => call[0] === 'POST')).toEqual([])
  })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd /tmp/gat && npx vitest run posthog/test`
Expected: FAIL — cannot find `view.js`; `componentProject` is not exported.

- [ ] **Step 3: Implement**

`posthog/canvas/runner-tradeoffs/src/view.js`:

```js
export const EMPTY_HINT =
  'No job runs in the window. A job shows here when the workflow telemetry action runs in it and ' +
  'the collect action reports its workflow. Run the runner-benchmark workflow to measure jobs on ' +
  'more runner labels.'

export function quote(value) {
  return `'${String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`
}

export function percentChange(from, to) {
  if (from == null || to == null || Number(from) === 0) return null
  return (Number(to) - Number(from)) / Number(from)
}

// A label is on the frontier when no other label is at least as fast and as cheap, and better in
// one of the two. Labels without a duration or a cost are not compared.
export function frontier(points) {
  const usable = points.filter(
    point => point.duration != null && point.cost != null
  )
  const beaten = point =>
    usable.some(
      other =>
        other !== point &&
        other.duration <= point.duration &&
        other.cost <= point.cost &&
        (other.duration < point.duration || other.cost < point.cost)
    )
  return new Set(
    usable.filter(point => !beaten(point)).map(point => point.label)
  )
}

export function formatDuration(seconds) {
  if (seconds == null) return '—'
  const total = Math.round(Number(seconds))
  if (total < 60) return `${total}s`
  return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, '0')}s`
}

export function formatCost(usd) {
  return usd == null ? 'no price' : `$${Number(usd).toFixed(3)}`
}

export function formatPercent(fraction) {
  if (fraction == null) return ''
  const percent = Math.round(fraction * 100)
  return `${percent > 0 ? '+' : ''}${percent}%`
}
```

`posthog/canvas/runner-tradeoffs/src/canvas.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Heading,
  SkeletonText,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
} from '@posthog/quill'
import { AlertTriangle } from 'lucide-react'
import {
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { BASELINE_LABEL, WINDOW_DAYS } from './settings.js'
import {
  EMPTY_HINT,
  formatCost,
  formatDuration,
  formatPercent,
  frontier,
  percentChange,
  quote,
} from './view.js'

const config = (typeof ph !== 'undefined' && ph.config) || {}
// An older runtime without ph.state keeps the workflow choice for the session only.
const stateApi =
  typeof ph !== 'undefined' && ph.state && typeof ph.state.get === 'function' ? ph.state : null

const SOURCE_STYLE = {
  measured: 'border border-border bg-card',
  calibrated: 'border border-primary',
  uncalibrated: 'border border-dashed border-border',
  does_not_fit: 'border border-border bg-muted text-muted-foreground',
}

const SOURCE_TEXT = {
  measured: 'Measured: 3 or more runs on this label',
  calibrated: 'Estimate, calibrated with benchmark runs',
  uncalibrated: 'Estimate, not calibrated: no benchmark pair for this label',
  does_not_fit: 'Does not fit: the job needs more than 90% of this label’s memory',
}

function rowsFrom(result) {
  const columns = result?.columns ?? []
  return (result?.results ?? []).map((row) =>
    Object.fromEntries(columns.map((column, index) => [column, row[index]]))
  )
}

function useQuery(sql) {
  const [state, setState] = useState({ loading: Boolean(sql), error: null, rows: null })
  useEffect(() => {
    if (!sql) {
      setState({ loading: false, error: null, rows: null })
      return
    }
    let cancelled = false
    setState({ loading: true, error: null, rows: null })
    ph.query(sql, {}, { refresh: 300 })
      .then((result) => {
        if (!cancelled) setState({ loading: false, error: null, rows: rowsFrom(result) })
      })
      .catch((error) => {
        if (!cancelled) {
          setState({ loading: false, error: String(error?.message ?? error), rows: null })
        }
      })
    return () => {
      cancelled = true
    }
  }, [sql])
  return state
}

function conditions(workflow, extra = []) {
  const parts = [...extra]
  if (config.repo) parts.push(`repo = ${quote(config.repo)}`)
  if (workflow) parts.push(`workflow = ${quote(workflow)}`)
  return parts.length ? `WHERE ${parts.join(' AND ')}` : ''
}

const LABELS_SQL = `SELECT runner_label, vcpus, mem_total_mb, price_per_minute_usd, queued_s_p50, runs
FROM ci_label_profile
ORDER BY vcpus, runner_label`

const WORKFLOWS_SQL = () => `SELECT DISTINCT workflow
FROM ci_job_tradeoffs
${conditions(null)}
ORDER BY workflow`

const TRADEOFFS_SQL = (workflow) => `SELECT repo, workflow, job_key, runner_label, source_label, is_current_label, runs,
    source, duration_p50_s, duration_p90_s, cost_per_run_usd, unreliable, runs_per_month
FROM ci_job_tradeoffs
${conditions(workflow)}
ORDER BY workflow, job_key, runner_label`

const BACKTEST_SQL = () => `SELECT backtest_kind, quantile(0.5)(abs(backtest_error)) AS median_abs_error, count() AS pairs
FROM ci_job_tradeoffs
${conditions(null, ['backtest_kind IS NOT NULL'])}
GROUP BY backtest_kind`

const STEPS_SQL = (repo, jobKey, label) => `SELECT step_name, t_s, estimate_s, c, w, p
FROM ci_step_tradeoffs
WHERE repo = ${quote(repo)} AND job_key = ${quote(jobKey)} AND target_label = ${quote(label)}
ORDER BY abs(estimate_s - t_s) DESC`

function QueryDialog({ title, sql }) {
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" size="sm">Query</Button>} />
      <DialogContent className="w-[92vw] max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] overflow-auto whitespace-pre-wrap rounded bg-muted p-3 font-mono text-xs">
          {sql}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Status({ state, sql, title, children }) {
  if (state.loading) return <SkeletonText lines={6} />
  if (state.error) {
    return (
      <div className="space-y-2">
        <Text>Could not load {title}: {state.error}</Text>
        <QueryDialog title={title} sql={sql} />
      </div>
    )
  }
  return children
}

function Header({ backtest }) {
  const byKind = Object.fromEntries((backtest.rows ?? []).map((row) => [row.backtest_kind, row]))
  const describe = (kind) =>
    backtest.error
      ? 'unavailable (see the Backtest query)'
      : byKind[kind]
      ? `${Math.round(Number(byKind[kind].median_abs_error) * 100)}% (${byKind[kind].pairs} pairs)`
      : 'no pairs yet'
  return (
    <div className="space-y-1">
      <Heading size="xl">Runner trade-offs</Heading>
      <Text>
        Last {WINDOW_DAYS} days. Baseline label {BASELINE_LABEL}. Median estimate error: calibrated{' '}
        {describe('calibrated')}, uncalibrated {describe('uncalibrated')}.
      </Text>
      <Text className="text-muted-foreground">
        Estimates use the average busy cores of each step, so short bursts of parallel work look
        serial: bursty steps such as compiles gain more on bigger runners than estimated. Only
        measured runs remove this bias.
      </Text>
    </div>
  )
}

function Cell({ row, current, selected, onSelect }) {
  if (!row) return <TableCell>—</TableCell>
  const change = row.is_current_label ? null : percentChange(current?.duration_p50_s, row.duration_p50_s)
  return (
    <TableCell>
      <button
        type="button"
        title={SOURCE_TEXT[row.source]}
        onClick={onSelect}
        className={
          'w-full rounded p-2 text-left ' +
          SOURCE_STYLE[row.source] +
          (selected ? ' ring-2 ring-primary' : '')
        }
      >
        <div className="flex items-center gap-1">
          {Number(row.unreliable) ? <AlertTriangle size={12} /> : null}
          <span className="font-medium">
            {row.source === 'does_not_fit' ? 'does not fit' : formatDuration(row.duration_p50_s)}
          </span>
          {Number(row.is_current_label) ? <Badge>current</Badge> : null}
        </div>
        <div className="text-xs text-muted-foreground">
          {row.source === 'does_not_fit' ? '' : formatCost(row.cost_per_run_usd)} {formatPercent(change)}
        </div>
      </button>
    </TableCell>
  )
}

function Plot({ rows }) {
  const points = rows
    .filter((row) => row.duration_p50_s != null && row.cost_per_run_usd != null)
    .map((row) => ({
      label: row.runner_label,
      duration: Number(row.duration_p50_s),
      cost: Number(row.cost_per_run_usd),
    }))
  const best = frontier(points)
  const shown = points.map((point) => ({
    ...point,
    name: best.has(point.label) ? `${point.label} ★` : point.label,
  }))
  if (!shown.length) return <Text>No label has both a duration and a price.</Text>
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 16, right: 24, bottom: 16, left: 8 }}>
          <CartesianGrid />
          <XAxis type="number" dataKey="cost" name="Cost per run" unit=" $" />
          <YAxis type="number" dataKey="duration" name="Duration" unit=" s" />
          <Tooltip />
          <Scatter data={shown}>
            <LabelList dataKey="name" position="top" />
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
      <Text className="text-muted-foreground">★ no other label is both faster and cheaper.</Text>
    </div>
  )
}

function Detail({ job, rows, label, onLabel }) {
  const sql = label ? STEPS_SQL(job.repo, job.job_key, label) : null
  const steps = useQuery(sql)
  const current = rows.find((row) => Number(row.is_current_label))
  const chosen = rows.find((row) => row.runner_label === label)
  const monthly =
    current && chosen && chosen.duration_p50_s != null && current.duration_p50_s != null
      ? {
          minutes:
            (Number(job.runs_per_month) * (chosen.duration_p50_s - current.duration_p50_s)) / 60,
          cost:
            chosen.cost_per_run_usd != null && current.cost_per_run_usd != null
              ? Number(job.runs_per_month) * (chosen.cost_per_run_usd - current.cost_per_run_usd)
              : null,
        }
      : null
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>
          {job.workflow} / {job.job_key}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Plot rows={rows} />
        <div className="flex flex-wrap gap-2">
          {rows.map((row) => (
            <Button
              key={row.runner_label}
              size="sm"
              variant={row.runner_label === label ? 'default' : 'outline'}
              onClick={() => onLabel(row.runner_label)}
            >
              {row.runner_label}
            </Button>
          ))}
        </div>
        {monthly ? (
          <Text>
            Moving {Math.round(Number(job.runs_per_month))} runs a month from {current.runner_label} to{' '}
            {label}: {monthly.minutes >= 0 ? '+' : ''}
            {Math.round(monthly.minutes)} min,{' '}
            {monthly.cost == null ? 'cost unknown' : `${monthly.cost >= 0 ? '+' : '-'}$${Math.abs(monthly.cost).toFixed(2)}`}{' '}
            a month.
          </Text>
        ) : null}
        {label ? (
          <Status state={steps} sql={sql} title="step estimates">
            <div className="flex justify-end">
              <QueryDialog title="Step estimates" sql={sql} />
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Step</TableHead>
                  <TableHead>t</TableHead>
                  <TableHead>t′ on {label}</TableHead>
                  <TableHead>busy cores c</TableHead>
                  <TableHead>idle share w</TableHead>
                  <TableHead>parallel share p</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(steps.rows ?? []).map((step) => (
                  <TableRow key={step.step_name}>
                    <TableCell>{step.step_name}</TableCell>
                    <TableCell>{formatDuration(step.t_s)}</TableCell>
                    <TableCell>{formatDuration(step.estimate_s)}</TableCell>
                    <TableCell>{Number(step.c).toFixed(2)}</TableCell>
                    <TableCell>{Number(step.w).toFixed(2)}</TableCell>
                    <TableCell>{Number(step.p).toFixed(2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Status>
        ) : null}
      </CardContent>
    </Card>
  )
}

export default function RunnerTradeoffs() {
  const [workflow, setWorkflow] = useState(config.workflow ?? null)
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    if (config.workflow || !stateApi) return
    stateApi
      .get('workflow', { scope: 'user' })
      .then((value) => {
        if (typeof value === 'string') setWorkflow(value)
      })
      .catch(() => {})
  }, [])

  const chooseWorkflow = (value) => {
    const next = value || null
    setWorkflow(next)
    setSelected(null)
    if (stateApi) stateApi.set('workflow', next, { scope: 'user' }).catch(() => {})
  }

  const labelsSql = LABELS_SQL
  const workflowsSql = config.workflow ? null : WORKFLOWS_SQL()
  const tradeoffsSql = TRADEOFFS_SQL(workflow)
  const backtestSql = BACKTEST_SQL()
  const labels = useQuery(labelsSql)
  const workflows = useQuery(workflowsSql)
  const tradeoffs = useQuery(tradeoffsSql)
  const backtest = useQuery(backtestSql)

  const jobs = useMemo(() => {
    const byJob = new Map()
    for (const row of tradeoffs.rows ?? []) {
      const key = `${row.repo}\u0000${row.job_key}`
      if (!byJob.has(key)) byJob.set(key, { ...row, cells: {} })
      byJob.get(key).cells[row.runner_label] = row
    }
    return [...byJob.values()]
  }, [tradeoffs.rows])

  const selectedJob = jobs.find((job) => `${job.repo}\u0000${job.job_key}` === selected?.job)

  return (
    <div className="flex min-h-screen flex-col gap-3 bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Header backtest={backtest} />
        <div className="flex items-center gap-2">
          {workflowsSql ? (
            <select
              className="rounded border border-border bg-card p-1 text-sm"
              value={workflow ?? ''}
              onChange={(event) => chooseWorkflow(event.target.value)}
            >
              <option value="">All workflows</option>
              {(workflows.rows ?? []).map((row) => (
                <option key={row.workflow} value={row.workflow}>
                  {row.workflow}
                </option>
              ))}
            </select>
          ) : null}
          <QueryDialog title="Trade-offs" sql={tradeoffsSql} />
          <QueryDialog title="Backtest" sql={backtestSql} />
          <QueryDialog title="Runner labels" sql={labelsSql} />
        </div>
      </div>

      <Card size="sm">
        <CardContent>
          <Status state={tradeoffs.error ? tradeoffs : labels} sql={tradeoffs.error ? tradeoffsSql : labelsSql} title="trade-offs">
            {!jobs.length ? (
              <Text>{EMPTY_HINT}</Text>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Job</TableHead>
                      {(labels.rows ?? []).map((label) => (
                        <TableHead key={label.runner_label}>
                          <div>{label.runner_label}</div>
                          <div className="text-xs font-normal text-muted-foreground">
                            {label.vcpus} vCPU · {Math.round(Number(label.mem_total_mb) / 1024)} GB ·{' '}
                            {label.price_per_minute_usd == null
                              ? 'no price: set runner_prices in the collect action'
                              : `$${Number(label.price_per_minute_usd).toFixed(3)}/min`}{' '}
                            · queue {formatDuration(label.queued_s_p50)}
                          </div>
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {jobs.map((job) => {
                      const key = `${job.repo}\u0000${job.job_key}`
                      const current = Object.values(job.cells).find((row) => Number(row.is_current_label))
                      const measured = Object.values(job.cells).some((row) => row.source === 'measured')
                      return (
                        <TableRow key={key}>
                          <TableCell>
                            <div className="font-medium">{job.job_key}</div>
                            <div className="text-xs text-muted-foreground">{job.workflow}</div>
                            {measured ? null : (
                              <div className="text-xs text-muted-foreground">
                                Run the runner-benchmark workflow to measure this job.
                              </div>
                            )}
                          </TableCell>
                          {(labels.rows ?? []).map((label) => (
                            <Cell
                              key={label.runner_label}
                              row={job.cells[label.runner_label]}
                              current={current}
                              selected={selected?.job === key && selected?.label === label.runner_label}
                              onSelect={() => setSelected({ job: key, label: label.runner_label })}
                            />
                          ))}
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </Status>
        </CardContent>
      </Card>

      {selectedJob ? (
        <Detail
          job={selectedJob}
          rows={(labels.rows ?? [])
            .map((label) => selectedJob.cells[label.runner_label])
            .filter(Boolean)}
          label={selected.label}
          onLabel={(label) => setSelected({ ...selected, label })}
        />
      ) : null}
    </div>
  )
}
```

Add to `posthog/lib/install.mjs`:

```js
import { readFileSync } from 'node:fs'

const COMPONENT_NAME = 'Runner trade-offs'
const GRID_NAME = 'CI runners'
const PLACEMENT_ID = 'runner-tradeoffs'
const COMPONENT_DEPENDENCIES = [
  'react',
  'react-dom',
  '@posthog/quill',
  'lucide-react',
  'recharts'
]
const FALLBACK_PROJECT = {
  entryHtml: 'index.html',
  files: {
    'index.html':
      '<!doctype html>\n<html>\n  <head>\n    <meta charset="utf-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1" />\n  </head>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="/src/canvas.tsx"></script>\n  </body>\n</html>\n'
  },
  dependencies: {
    react: '19.0.0',
    'react-dom': '19.0.0',
    '@posthog/quill': '0.3.0-beta.18',
    'lucide-react': '1.21.0',
    recharts: '2.15.0'
  },
  canvasSdkVersion: '0.2.0'
}

const canvasFile = path =>
  readFileSync(
    new URL(`../canvas/runner-tradeoffs/${path}`, import.meta.url),
    'utf8'
  )

// The shell and the dependency pins come from the canvas's current source, so they match the
// platform's supported versions; a canvas with no source yet uses the fallback.
export function componentProject(source, { windowDays, baselineLabel }) {
  const base = source?.project?.files?.['index.html']
    ? source.project
    : FALLBACK_PROJECT
  const dependencies = Object.fromEntries(
    Object.entries({
      ...FALLBACK_PROJECT.dependencies,
      ...base.dependencies
    }).filter(([name]) => COMPONENT_DEPENDENCIES.includes(name))
  )
  return {
    schemaVersion: 1,
    entryHtml: base.entryHtml ?? 'index.html',
    files: {
      'index.html': base.files['index.html'],
      'src/canvas.tsx': canvasFile('src/canvas.tsx'),
      'src/view.js': canvasFile('src/view.js'),
      'src/settings.js': `export const WINDOW_DAYS = ${windowDays}\nexport const BASELINE_LABEL = '${baselineLabel}'\n`
    },
    dependencies,
    canvasSdkVersion:
      base.canvasSdkVersion ?? FALLBACK_PROJECT.canvasSdkVersion,
    capabilities: {
      posthog: {
        insights: [],
        inlineQueries: true,
        captureEvents: [],
        state: ['user'],
        actions: []
      },
      network: { origins: [] }
    },
    component: {
      size: { defaultW: 12, defaultH: 24, minW: 6, minH: 10 },
      configSchema: {
        type: 'object',
        properties: {
          repo: {
            type: 'string',
            description: 'Repository (owner/name) to show; all when empty'
          },
          workflow: {
            type: 'string',
            description:
              'Workflow to show; when empty, each viewer picks one'
          }
        }
      }
    }
  }
}

async function findCanvas(api, channelId, kind, name) {
  const list = await api.get(
    `/canvases/?channel=${encodeURIComponent(channelId)}&kind=${kind}&limit=100`
  )
  return (list.results ?? []).find(canvas => canvas.name === name) ?? null
}

export async function upsertComponent(api, { channelId, settings }, log = console.log) {
  const canvas =
    (await findCanvas(api, channelId, 'component', COMPONENT_NAME)) ??
    (await api.post('/canvases/', {
      name: COMPONENT_NAME,
      channel_id: channelId,
      kind: 'component',
      description:
        'CI job duration and cost on each runner label, measured or estimated from CPU use. ' +
        'Config: repo and workflow filters.'
    }))
  const source = await api.get(`/canvases/${canvas.id}/source/`)
  const project = componentProject(source, settings)
  const published = await api.post(`/canvases/${canvas.id}/publish/`, {
    project,
    prompt: 'Install Runner trade-offs from GitHub-Action-Telemetry',
    expected_current_version_id: source?.current_version_id ?? null
  })
  const status = published?.build?.status ?? 'unknown'
  if (status === 'failed') {
    throw new Error(
      `The canvas build failed: ${JSON.stringify(published.build)}`
    )
  }
  log(`${COMPONENT_NAME}: published, build ${status} (${canvas.url ?? canvas.id})`)
  return canvas.id
}

export async function ensureGrid(api, { channelId, componentId }, log = console.log) {
  const grid =
    (await findCanvas(api, channelId, 'grid', GRID_NAME)) ??
    (await api.post('/canvases/', {
      name: GRID_NAME,
      channel_id: channelId,
      kind: 'grid',
      description: 'CI runner trade-offs'
    }))
  const current = await api.get(`/canvases/${grid.id}/layout/`)
  const layout = current?.layout ?? null
  const placements = layout?.placements ?? []
  if (placements.some(placement => placement.id === PLACEMENT_ID)) {
    log(`${GRID_NAME}: unchanged`)
    return 'unchanged'
  }
  const bottom = Math.max(0, ...placements.map(p => p.y + p.h))
  await api.post(`/canvases/${grid.id}/layout/publish/`, {
    layout: {
      schemaVersion: 1,
      grid: layout?.grid ?? { columns: 12, rowHeight: 48, gap: 12 },
      placements: [
        ...placements,
        {
          id: PLACEMENT_ID,
          status: 'live',
          component: componentId,
          x: 0,
          y: bottom,
          w: 12,
          h: 24,
          config: {}
        }
      ]
    },
    prompt: 'Add Runner trade-offs',
    expected_current_version_id: current?.current_version_id ?? null
  })
  log(`${GRID_NAME}: created (${grid.url ?? grid.id})`)
  return 'created'
}
```

Move the `readFileSync` import to the top of the file with the other import.

`posthog/install.mjs`: replace the last `if (!values.channel) { ... }` block with:

```js
if (values.channel) {
  const componentId = await upsertComponent(api, {
    channelId: values.channel,
    settings: options
  })
  await ensureGrid(api, { channelId: values.channel, componentId })
} else {
  console.log('No --channel: the views are installed, the canvas is not.')
}
```

and import `ensureGrid, upsertComponent` from `./lib/install.mjs`.

- [ ] **Step 4: Run the tests**

Run: `cd /tmp/gat && npx vitest run posthog/test && npm run format && npm run all`
Expected: PASS.

- [ ] **Step 5: Validate the canvas project without publishing**

Build the project JSON and validate it read-only against any existing canvas in a project you may read (PostHog MCP `canvas-validate-create` with `{ id: <canvas id>, project: <json> }`, or `POST /api/projects/<id>/canvases/<canvas id>/validate/`):

Run: `cd /tmp/gat && node -e "import('./posthog/lib/install.mjs').then(m => console.log(JSON.stringify(m.componentProject(null, { windowDays: 14, baselineLabel: 'ubuntu-latest' }))))" > /tmp/runner-tradeoffs-project.json`
Expected: validation returns `valid: true` with no error diagnostics. Fix every error diagnostic before you continue. A canvas that is not of kind `component` can reject the `component` key; that one diagnostic is expected, and publish-time validation in Task 11 covers it. Do not create a canvas for this step without the user's agreement.

- [ ] **Step 6: Commit**

```bash
cd /tmp/gat && git add -A && git commit -m "$(cat <<'EOF'
feat(posthog): add the Runner trade-offs canvas and its install

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Docs and CI for the SQL checks

**Files:**
- Create: `docs/rightsizing.md`, `.github/workflows/posthog-checks.yml`
- Modify: `README.md` (new section after "Collect run and job timings and cost"), `CHANGELOG.md` (3.1.0 "Added")

**Interfaces:**
- Consumes: everything above. Produces documentation only.

- [ ] **Step 1: Write `docs/rightsizing.md`**

````markdown
# Runner rightsizing in PostHog

Shows, for each CI job, the duration and the cost on each runner label. It does not choose a
label: you read the trade-offs and decide.

## What you need

- This action in the jobs you want to compare, with `posthog_api_key` set.
- The `collect` action for the same workflows (it gives the duration, the price and the
  conclusion). A job whose workflow `collect` does not report is not shown.
- `runner_prices` in `collect` for every label you use. A label without a price shows "no price".
- To measure jobs on more labels: a workflow that runs the same jobs on several labels in one run
  (a runner benchmark). These runs also calibrate the per-core speed of each label.
- A matrix that runs different work under one job id needs `job_key`, for example
  `job_key: warm-${{ matrix.kind }}`.

## Install

```bash
POSTHOG_PERSONAL_API_KEY=phx_... node posthog/install.mjs --project <project id> \
  --channel <channel id> [--window-days 14] [--baseline ubuntu-latest]
```

The key needs `warehouse_view:read`, `warehouse_view:write`, `canvas:read` and `canvas:write`.
Without `--channel`, the script installs the views only. A second run changes nothing unless the
SQL or the canvas source changed.

## How to read it

Each cell is one job on one label:

| Style | Meaning |
|---|---|
| solid | measured: 3 or more successful runs on the label in the window (p50) |
| outline | estimate, calibrated: both labels have a speed factor from benchmark runs |
| dashed | estimate, not calibrated: per-core speed is taken as equal |
| grey | does not fit: the job's median peak memory is above 90% of the label's memory |
| ⚠ | unreliable: the job used swap or had more than 20% I/O wait |

The header shows the median estimate error of each kind, from jobs measured on more than one
label (the backtest).

## Model

For each step of a job on its source label (the label with the most runs), with the median
duration `t` and median busy cores `c`:

```
w  = max(0, 1 − c)                     share of time with no CPU work
p  = clamp((c − 1) / (Nₛ − 1), 0, 1)   parallel share
t' = t × [ w + (1 − w) × ((1 − p) + p × Nₛ/Nₜ) × kₛ/kₜ ]
```

`N` is the vCPU count and `k` the per-core speed factor of a label (1 for the baseline label and
for labels without benchmark pairs). The job estimate is the source label's median job duration
plus the step changes. The cost is the estimate in whole minutes times the label's price. Queue
time is measured only.

`k` of a label is the median of baseline time / label time over single-threaded steps (at most
1.2 busy cores, at least 20 s on the baseline) that ran on both labels in the same run.

## Known bias

`c` is an average over the step, so short bursts of parallel work look serial. Bursty steps such
as compiles gain more on bigger runners than the estimate says. Calibration does not fix this;
measured runs do.

## Views

`ci_job_runs`, `ci_step_runs`, `ci_label_profile`, `ci_label_speed`, `ci_job_label_stats`,
`ci_job_sources`, `ci_step_tradeoffs`, `ci_job_tradeoffs`. You can use them in insights and SQL.
The SQL is in `posthog/sql/`.
````

- [ ] **Step 2: README and CHANGELOG**

`README.md`: add after the "Collect run and job timings and cost" section:

```markdown
## Rightsizing in PostHog

Saved SQL views and a PostHog Desktop canvas show, for each job, the duration and the cost on
each runner label, measured or estimated from CPU use. See [docs/rightsizing.md](docs/rightsizing.md).
```

`CHANGELOG.md`, in `## 3.1.0` → `### Added`, add:

```markdown
- `posthog/`: saved SQL views and the "Runner trade-offs" canvas for runner rightsizing, with an
  install script (`node posthog/install.mjs`). See `docs/rightsizing.md`.
```

- [ ] **Step 3: CI workflow for the SQL checks**

`.github/workflows/posthog-checks.yml`:

```yaml
name: posthog-checks

# Runs the SQL checks of posthog/ through the PostHog query API. The checks skip when the secret
# POSTHOG_CHECKS_API_KEY (scope query:read) or the variable POSTHOG_CHECKS_PROJECT_ID is not set.
on:
  pull_request:
    paths:
      - "posthog/**"
  workflow_dispatch:

permissions:
  contents: read

jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run test:posthog
        env:
          POSTHOG_PERSONAL_API_KEY: ${{ secrets.POSTHOG_CHECKS_API_KEY }}
          POSTHOG_PROJECT_ID: ${{ vars.POSTHOG_CHECKS_PROJECT_ID }}
```

- [ ] **Step 4: Run all checks**

Run: `cd /tmp/gat && npm run format && npm run all && npm run test:posthog`
Expected: `npm run all` passes; `test:posthog` passes with the env set, or reports 9 skipped checks without it.

- [ ] **Step 5: Commit**

```bash
cd /tmp/gat && git add -A && git commit -m "$(cat <<'EOF'
docs: document runner rightsizing and run the SQL checks in CI

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Release v3.1.0, pin it in the monorepo, live acceptance

Every step in this task is outward-facing. Ask the user before each push, PR, merge, release and install.

**Files:**
- Modify (monorepo worktree `/Users/mateo/playgrounds/ryzome/ryzome-runner-benchmark`, branch `ci-runner-benchmark`): every `0xPlaygrounds/GitHub-Action-Telemetry@<sha> # v3.0.0` and `.../collect@<sha> # v3.0.0` line in `.github/workflows/*.yaml`; `.github/workflows/ci-rust-cache-main.yaml` (telemetry step `with:`).

- [ ] **Step 1: Fork PR, CI, merge, release**

```bash
cd /tmp/gat && git push -u origin rightsizing-spec
gh pr create --repo 0xPlaygrounds/GitHub-Action-Telemetry --base master --head rightsizing-spec \
  --title "feat: runner rightsizing in PostHog (v3.1.0)" --body-file <body file>
gh pr checks --repo 0xPlaygrounds/GitHub-Action-Telemetry --watch
```

Expected: build, self-test (now checks `job_key` and `repo`), posthog-checks pass. Then squash-merge and run the release workflow with version `3.1.0`:

```bash
gh workflow run release.yml --repo 0xPlaygrounds/GitHub-Action-Telemetry -f version=3.1.0
gh api repos/0xPlaygrounds/GitHub-Action-Telemetry/git/ref/tags/v3.1.0 -q .object.sha
```

- [ ] **Step 2: Pin v3.1.0 in the monorepo**

Replace the old SHA with the v3.1.0 SHA and `# v3.0.0` with `# v3.1.0` in all workflow files:

```bash
cd /Users/mateo/playgrounds/ryzome/ryzome-runner-benchmark
old=1b203adead4929a36e673c6b0f772bbc85f3fe7d
new=<v3.1.0 sha>
grep -rl "$old" .github/workflows | xargs sed -i '' -e "s/$old # v3.0.0/$new # v3.1.0/g"
grep -rn "GitHub-Action-Telemetry" .github/workflows | grep -v "$new" || echo "all pinned"
```

In `.github/workflows/ci-rust-cache-main.yaml`, in the "Collect workflow telemetry" step, add under `with:`:

```yaml
          job_key: warm-${{ matrix.kind }}
```

Commit (`ci: pin workflow telemetry v3.1.0`) and push after the user agrees. Wait for CI and check that each sampled job logs "Sent resource use".

- [ ] **Step 3: Install in the E2E/CI project**

The user runs (or grants access to that project and gives a key):

```bash
cd /tmp/gat && POSTHOG_PERSONAL_API_KEY=<key> node posthog/install.mjs --project <E2E/CI project id> \
  --channel <channel id> --window-days 14 --baseline ubuntu-latest
```

Expected: 8 views `created`, component published (build `ready` or `queued`), grid `created`. A second run prints `unchanged` for every view and the grid.

- [ ] **Step 4: Live data checks**

In the E2E/CI project, run:

```sql
SELECT count() AS rows, uniq(job_id) AS jobs FROM ci_job_runs
```

Expected: `rows = jobs` (duplicate events collapse).

```sql
SELECT job_key, runner_label, source, duration_p50_s, cost_per_run_usd
FROM ci_job_tradeoffs
ORDER BY job_key, runner_label
```

Expected: one row for each job and label, with `measured` for the labels with 3 or more runs.

- [ ] **Step 5: Calibrate and accept**

The user runs the runner-benchmark workflow once with the 4 labels. After the CI telemetry runs finish:

```sql
SELECT * FROM ci_label_speed
```

Expected: one row for each benchmarked label. Then:

```sql
SELECT backtest_kind, quantile(0.5)(abs(backtest_error)) AS median_abs_error, count() AS pairs
FROM ci_job_tradeoffs
WHERE backtest_kind IS NOT NULL
GROUP BY backtest_kind
```

Expected: calibrated `median_abs_error <= 0.2`. Report the result to the user with the canvas link. If the error is above 0.2, report it with the worst rows (largest `abs(backtest_error)`), and do not change thresholds without the user.
