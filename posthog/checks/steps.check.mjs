import { test } from 'node:test'
import { fixture, readView, withFixtures } from '../lib/sql.mjs'
import { assertRows, checkOptions, runQuery } from './query.mjs'

const options = { windowDays: 14, baselineLabel: 'small' }

test(
  'ci_step_tradeoffs applies the formula to each step',
  checkOptions,
  async () => {
    const stepRuns = fixture(
      [
        'repo',
        'job_key',
        'runner_label',
        'step_name',
        'duration_s',
        'cores_busy_avg'
      ],
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
        {
          step_name: 'net',
          target_label: 'big',
          t_s: 100,
          w: 0.8,
          p: 0,
          estimate_s: 96
        },
        { step_name: 'net', target_label: 'fast', t_s: 100, estimate_s: 100 },
        { step_name: 'net', target_label: 'small', t_s: 100, estimate_s: 100 },
        {
          step_name: 'parallel',
          target_label: 'big',
          t_s: 300,
          w: 0,
          p: 1,
          estimate_s: 60
        },
        {
          step_name: 'parallel',
          target_label: 'fast',
          t_s: 300,
          estimate_s: 150
        },
        {
          step_name: 'parallel',
          target_label: 'small',
          t_s: 300,
          estimate_s: 300
        },
        {
          step_name: 'single',
          target_label: 'big',
          t_s: 200,
          w: 0,
          p: 0,
          estimate_s: 160
        },
        {
          step_name: 'single',
          target_label: 'fast',
          t_s: 200,
          estimate_s: 200
        },
        {
          step_name: 'single',
          target_label: 'small',
          t_s: 200,
          estimate_s: 200
        }
      ],
      ['step_name', 'target_label']
    )
  }
)
