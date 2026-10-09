import { test } from 'node:test'
import {
  fixture,
  raw,
  readView,
  withFixtures,
  type RawSql
} from '../lib/sql.ts'
import { assertRows, checkOptions, runQuery } from './query.ts'

const options = { windowDays: 14, baselineLabel: 'small' }
const at = (day: number): RawSql =>
  raw(`toDateTime('2026-10-0${day} 10:00:00')`)

test(
  'ci_label_profile keeps the latest known price',
  checkOptions,
  async () => {
    const jobRuns = fixture(
      [
        'runner_label',
        'vcpus',
        'mem_total_mb',
        'cpu_model',
        'price_per_minute_usd',
        'queued_s',
        'completed_at'
      ],
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
        {
          runner_label: 'big',
          vcpus: 8,
          mem_total_mb: 32000,
          cpu_model: 'EPYC 2',
          price_per_minute_usd: 0.022,
          queued_s_p50: 20,
          runs: 2
        },
        {
          runner_label: 'small',
          vcpus: 2,
          mem_total_mb: 8000,
          cpu_model: 'Xeon',
          price_per_minute_usd: 0.006,
          queued_s_p50: 5,
          runs: 1
        }
      ],
      ['runner_label']
    )
  }
)

test(
  'ci_label_speed pairs single-threaded steps of one run',
  checkOptions,
  async () => {
    const stepRuns = fixture(
      [
        'repo',
        'job_key',
        'run_id',
        'runner_label',
        'step_name',
        'duration_s',
        'cores_busy_avg'
      ],
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
        ['o/r', 'build', '2', 'small', 'a', 100, 1.0],
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
  }
)
