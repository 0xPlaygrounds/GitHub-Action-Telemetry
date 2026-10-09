import { test } from 'node:test'
import { fixture, readView, withFixtures } from '../lib/sql.ts'
import { assertRows, checkOptions, runQuery } from './query.ts'

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
    [
      'repo',
      'job_key',
      'runner_label',
      'runs',
      'duration_p50_s',
      'duration_p90_s',
      'mem_peak_mb_p50',
      'swap_peak_mb_max',
      'iowait_pct_p50'
    ],
    [
      ['o/r', 'build', 'small', 10, 600, 700, 2000, 0, 5],
      ['o/r', 'build', 'big', 3, 200, 220, 2100, 0, 4],
      ['o/r', 'lint', 'small', 2, 120, 130, 500, 64, 3],
      ['o/r', 'nosteps', 'small', 5, 90, 95, 100, 0, 1],
      ['o/r', 'instant', 'small', 5, 10, 12, 100, 0, 1],
      ['o/r', 'instant', 'big', 3, 0, 0, 100, 0, 1],
      ['o/r', 'coldstart', 'small', 10, 50, 55, 100, 0, 1],
      ['o/r', 'coldstart', 'big', 3, 40, 45, 100, 0, 1],
      ['o/r', 'skew', 'small', 5, 101, 110, 100, 0, 1]
    ]
  ),
  ci_job_sources: fixture(
    [
      'repo',
      'job_key',
      'workflow',
      'source_label',
      'current_label',
      'normal_runs'
    ],
    [
      ['o/r', 'build', 'CI', 'small', 'small', 10],
      ['o/r', 'lint', 'CI', 'small', 'small', 2],
      ['o/r', 'nosteps', 'CI', 'small', 'small', 5],
      ['o/r', 'instant', 'CI', 'small', 'small', 5],
      ['o/r', 'coldstart', 'CI', 'small', 'small', 10],
      ['o/r', 'skew', 'CI', 'small', 'small', 5]
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
      ['o/r', 'instant', 'tiny', 10, 10],
      ['o/r', 'skew', 'small', 120, 120],
      ['o/r', 'skew', 'small', 80, 80],
      ['o/r', 'skew', 'big', 120, 20],
      ['o/r', 'skew', 'big', 80, 10],
      ['o/r', 'skew', 'fast', 120, 100],
      ['o/r', 'skew', 'fast', 80, 70],
      ['o/r', 'skew', 'tiny', 120, 120],
      ['o/r', 'skew', 'tiny', 80, 80]
    ]
  )
}

test('ci_job_tradeoffs applies the rules', checkOptions, async () => {
  const sql = withFixtures(readView('ci_job_tradeoffs', options), fixtures)
  const rows = await runQuery(sql)
  assertRows(
    rows.filter(
      row =>
        row.job_key !== 'instant' &&
        row.job_key !== 'coldstart' &&
        row.job_key !== 'skew'
    ),
    [
      {
        job_key: 'build',
        runner_label: 'big',
        source_label: 'small',
        source: 'measured',
        is_current_label: false,
        runs: 3,
        duration_p50_s: 200,
        duration_p90_s: 220,
        cost_per_run_usd: 0.088,
        unreliable: false,
        queued_s_p50: 30,
        backtest_estimate_s: 316,
        backtest_error: 0.58,
        backtest_kind: 'calibrated'
      },
      {
        job_key: 'build',
        runner_label: 'fast',
        source_label: 'small',
        source: 'uncalibrated',
        is_current_label: false,
        runs: 0,
        duration_p50_s: 450,
        duration_p90_s: null,
        cost_per_run_usd: 0.064,
        unreliable: false,
        queued_s_p50: 2,
        backtest_kind: null
      },
      {
        job_key: 'build',
        runner_label: 'small',
        source_label: 'small',
        source: 'measured',
        is_current_label: true,
        runs: 10,
        duration_p50_s: 600,
        duration_p90_s: 700,
        cost_per_run_usd: 0.06,
        unreliable: false,
        queued_s_p50: 5,
        runs_per_month: 300 / 14,
        backtest_kind: null
      },
      {
        job_key: 'build',
        runner_label: 'tiny',
        source_label: 'small',
        source: 'does_not_fit',
        is_current_label: false,
        runs: 0,
        duration_p50_s: null,
        duration_p90_s: null,
        cost_per_run_usd: null,
        unreliable: false,
        queued_s_p50: 1
      },
      {
        job_key: 'lint',
        runner_label: 'big',
        source_label: 'small',
        source: 'calibrated',
        is_current_label: false,
        runs: 0,
        duration_p50_s: 100,
        duration_p90_s: null,
        cost_per_run_usd: 0.044,
        unreliable: true,
        queued_s_p50: 30
      },
      {
        job_key: 'lint',
        runner_label: 'fast',
        source_label: 'small',
        source: 'uncalibrated',
        is_current_label: false,
        runs: 0,
        duration_p50_s: 120,
        duration_p90_s: null,
        unreliable: true,
        queued_s_p50: 2
      },
      {
        job_key: 'lint',
        runner_label: 'small',
        source_label: 'small',
        source: 'calibrated',
        is_current_label: true,
        runs: 2,
        duration_p50_s: 120,
        duration_p90_s: null,
        cost_per_run_usd: 0.012,
        unreliable: true,
        queued_s_p50: 5
      },
      {
        job_key: 'lint',
        runner_label: 'tiny',
        source_label: 'small',
        source: 'uncalibrated',
        is_current_label: false,
        runs: 0,
        duration_p50_s: 120,
        duration_p90_s: null,
        cost_per_run_usd: null,
        unreliable: true,
        queued_s_p50: 1
      },
      {
        job_key: 'nosteps',
        runner_label: 'big',
        source_label: 'small',
        source: 'calibrated',
        is_current_label: false,
        runs: 0,
        duration_p50_s: null,
        duration_p90_s: null,
        unreliable: false,
        queued_s_p50: 30
      },
      {
        job_key: 'nosteps',
        runner_label: 'fast',
        source_label: 'small',
        source: 'uncalibrated',
        is_current_label: false,
        runs: 0,
        duration_p50_s: null,
        duration_p90_s: null,
        unreliable: false,
        queued_s_p50: 2
      },
      {
        job_key: 'nosteps',
        runner_label: 'small',
        source_label: 'small',
        source: 'measured',
        is_current_label: true,
        runs: 5,
        duration_p50_s: 90,
        duration_p90_s: 95,
        unreliable: false,
        queued_s_p50: 5
      },
      {
        job_key: 'nosteps',
        runner_label: 'tiny',
        source_label: 'small',
        source: 'uncalibrated',
        is_current_label: false,
        runs: 0,
        duration_p50_s: null,
        duration_p90_s: null,
        unreliable: false,
        queued_s_p50: 1
      }
    ],
    ['job_key', 'runner_label']
  )
})

test(
  'ci_job_tradeoffs gives no backtest for a measured p50 of 0',
  checkOptions,
  async () => {
    const sql = withFixtures(readView('ci_job_tradeoffs', options), fixtures)
    const rows = await runQuery(sql)
    assertRows(
      rows.filter(
        row => row.job_key === 'instant' && row.runner_label === 'big'
      ),
      [
        {
          job_key: 'instant',
          runner_label: 'big',
          source: 'measured',
          backtest_error: null,
          backtest_kind: null
        }
      ],
      ['job_key', 'runner_label']
    )
  }
)

test(
  'ci_job_tradeoffs gives no backtest for a job with no step data',
  checkOptions,
  async () => {
    const sql = withFixtures(readView('ci_job_tradeoffs', options), fixtures)
    const rows = await runQuery(sql)
    assertRows(
      rows.filter(
        row => row.job_key === 'coldstart' && row.runner_label === 'big'
      ),
      [
        {
          job_key: 'coldstart',
          runner_label: 'big',
          source: 'measured',
          backtest_error: null,
          backtest_kind: null
        }
      ],
      ['job_key', 'runner_label']
    )
  }
)

test(
  'ci_job_tradeoffs clamps the time outside steps at 0',
  checkOptions,
  async () => {
    const sql = withFixtures(readView('ci_job_tradeoffs', options), fixtures)
    const rows = await runQuery(sql)
    assertRows(
      rows.filter(row => row.job_key === 'skew' && row.runner_label === 'big'),
      [
        {
          job_key: 'skew',
          runner_label: 'big',
          source: 'calibrated',
          duration_p50_s: 30
        }
      ],
      ['job_key', 'runner_label']
    )
  }
)
