import { test } from 'node:test'
import { fixture, raw, readView, withFixtures } from '../lib/sql.mjs'
import { assertRows, checkOptions, runQuery } from './query.mjs'

const options = { windowDays: 14, baselineLabel: 'small' }
const at = day => raw(`toDateTime('2026-10-0${day} 10:00:00')`)

test(
  'ci_job_label_stats aggregates runs per job and label',
  checkOptions,
  async () => {
    const jobRuns = fixture(
      [
        'repo',
        'job_key',
        'runner_label',
        'workflow',
        'duration_s',
        'mem_peak_mb',
        'swap_peak_mb',
        'iowait_avg_pct',
        'trigger',
        'completed_at'
      ],
      [
        ['o/r', 'build', 'small', 'CI', 100, 1000, 0, 5, 'push', at(1)],
        ['o/r', 'build', 'small', 'CI', 200, 1200, 0, 7, 'pull_request', at(2)],
        ['o/r', 'build', 'small', 'CI', 300, 1400, 32, 9, 'push', at(3)],
        [
          'o/r',
          'build',
          'big',
          'Runner benchmark',
          50,
          1100,
          0,
          4,
          'workflow_dispatch',
          at(4)
        ]
      ]
    )
    const sql = withFixtures(readView('ci_job_label_stats', options), {
      ci_job_runs: jobRuns
    })
    assertRows(
      await runQuery(sql),
      [
        {
          runner_label: 'big',
          workflow: 'Runner benchmark',
          runs: 1,
          duration_p50_s: 50,
          normal_runs: 0
        },
        {
          runner_label: 'small',
          workflow: 'CI',
          runs: 3,
          duration_p50_s: 200,
          duration_p90_s: 280,
          mem_peak_mb_p50: 1200,
          swap_peak_mb_max: 32,
          iowait_pct_p50: 7,
          normal_runs: 3,
          last_normal_run_at: '2026-10-03T10:00:00Z'
        }
      ],
      ['runner_label']
    )
  }
)

test(
  'ci_job_sources picks the source and the current label',
  checkOptions,
  async () => {
    const stats = fixture(
      [
        'repo',
        'job_key',
        'runner_label',
        'workflow',
        'runs',
        'normal_runs',
        'last_normal_run_at'
      ],
      [
        ['o/r', 'build', 'small', 'CI', 3, 3, at(3)],
        [
          'o/r',
          'build',
          'big',
          'Runner benchmark',
          3,
          0,
          raw("toDateTime('1970-01-01 00:00:00')")
        ],
        ['o/r', 'build', 'fast', 'CI fast', 1, 1, at(5)],
        [
          'o/r',
          'bench',
          'big',
          'Runner benchmark',
          2,
          0,
          raw("toDateTime('1970-01-01 00:00:00')")
        ]
      ]
    )
    const sql = withFixtures(readView('ci_job_sources', options), {
      ci_job_label_stats: stats
    })
    assertRows(
      await runQuery(sql),
      [
        {
          job_key: 'bench',
          source_label: 'big',
          current_label: '',
          normal_runs: 0,
          workflow: 'Runner benchmark'
        },
        {
          job_key: 'build',
          source_label: 'small',
          current_label: 'fast',
          normal_runs: 4,
          workflow: 'CI fast'
        }
      ],
      ['job_key']
    )
  }
)
