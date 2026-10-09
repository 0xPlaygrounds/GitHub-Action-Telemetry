import { describe, expect, it } from 'vitest'
import { buildEvents } from './collectEvents.js'
import type { WorkflowJobType, WorkflowRunType } from './interfaces/index.js'

const run = {
  id: 1,
  name: 'CI',
  run_attempt: 1,
  event: 'pull_request',
  head_branch: 'main',
  head_sha: 'abc',
  html_url: 'https://example.test/run',
  updated_at: '2026-01-01T00:10:00Z',
  run_started_at: '2026-01-01T00:00:00Z',
  conclusion: 'success',
  pull_requests: []
} as unknown as WorkflowRunType

const job = (
  id: number,
  labels: string[],
  start: string | null,
  end: string | null,
  conclusion = 'success'
): WorkflowJobType =>
  ({
    id,
    name: `job ${id}`,
    labels,
    created_at: '2026-01-01T00:00:00Z',
    started_at: start,
    completed_at: end,
    conclusion,
    steps: []
  }) as unknown as WorkflowJobType

describe('buildEvents', () => {
  it('rounds billable minutes up and prices them by runner label', () => {
    const events = buildEvents(
      'o/r',
      run,
      [job(1, ['big'], '2026-01-01T00:00:00Z', '2026-01-01T00:01:01Z')],
      { big: 0.022 }
    )
    expect(events[0].properties).toMatchObject({
      billable_minutes: 2,
      cost_usd: 0.044
    })
    expect(events[1]).toMatchObject({
      event: 'ci_run',
      properties: { billable_minutes: 2, cost_usd: 0.044 }
    })
  })

  it('gives skipped jobs no cost and an unknown label no price', () => {
    const events = buildEvents(
      'o/r',
      run,
      [
        job(1, ['ubuntu-latest'], null, null, 'skipped'),
        job(2, ['custom'], '2026-01-01T00:00:00Z', '2026-01-01T00:00:30Z')
      ],
      { 'ubuntu-latest': 0.006 }
    )
    expect(events[0].properties).toMatchObject({
      billable_minutes: 0,
      cost_usd: 0
    })
    expect(events[1].properties).toMatchObject({
      billable_minutes: 1,
      cost_usd: null
    })
    expect(events[2].properties).toMatchObject({
      cost_usd: null,
      jobs_skipped: 1
    })
  })

  it('adds the repository to job and run events', () => {
    const events = buildEvents(
      'o/r',
      run,
      [job(1, ['big'], '2026-01-01T00:00:00Z', '2026-01-01T00:01:01Z')],
      { big: 0.022 }
    )
    expect(events.map(event => event.properties.repo)).toEqual(['o/r', 'o/r'])
  })
})
