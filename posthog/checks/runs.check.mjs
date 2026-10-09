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
    [
      'repo',
      'job_key',
      'job_id',
      'run_id',
      'runner_label',
      'sha',
      'trigger',
      'steps_json'
    ],
    [
      [
        'o/r',
        'build',
        '1',
        '10',
        'small',
        'abc',
        'push',
        '[{"name":"a","duration_s":12.5,"cores_busy_avg":1.5},{"name":"b","duration_s":3,"cores_busy_avg":null}]'
      ],
      ['o/r', 'lint', '2', '10', 'small', 'abc', 'push', null]
    ]
  )
  const sql = withFixtures(readView('ci_step_runs', options), {
    ci_job_runs: jobRuns
  })
  assertRows(
    await runQuery(sql),
    [
      {
        job_key: 'build',
        step_name: 'a',
        duration_s: 12.5,
        cores_busy_avg: 1.5
      },
      { job_key: 'build', step_name: 'b', duration_s: 3, cores_busy_avg: 0 }
    ],
    ['job_key', 'step_name']
  )
})
