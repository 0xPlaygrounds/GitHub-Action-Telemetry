import type { WorkflowJobType, WorkflowRunType } from './interfaces/index.js'
import { eventUuid, type PostHogEvent } from './posthog.js'

// USD per minute of GitHub's standard x64 Linux runners. GitHub bills each job in whole minutes.
export const DEFAULT_RUNNER_PRICES: Record<string, number> = {
  'ubuntu-latest': 0.006,
  'ubuntu-24.04': 0.006,
  'ubuntu-22.04': 0.006
}

const seconds = (from?: string | null, to?: string | null): number | null =>
  from && to
    ? Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 1000))
    : null

// One ci_job event per job and one ci_run event for the run.
export function buildEvents(
  repo: string,
  run: WorkflowRunType,
  jobs: WorkflowJobType[],
  prices: Record<string, number>
): PostHogEvent[] {
  const runContext = {
    $process_person_profile: false,
    repo,
    workflow: run.name,
    event: run.event,
    branch: run.head_branch,
    sha: run.head_sha,
    pr_number: run.pull_requests?.[0]?.number ?? null,
    run_id: run.id,
    run_attempt: run.run_attempt,
    run_url: run.html_url
  }

  const jobEvents = jobs.map(job => {
    const duration = seconds(job.started_at, job.completed_at)
    const billableMinutes = duration == null ? 0 : Math.ceil(duration / 60)
    const price = job.labels.map(label => prices[label]).find(Boolean) ?? null
    return {
      event: 'ci_job',
      distinct_id: 'ci',
      uuid: eventUuid(repo, run.id, run.run_attempt ?? 1, job.id),
      timestamp: job.completed_at ?? run.updated_at,
      properties: {
        ...runContext,
        job: job.name,
        job_id: job.id,
        conclusion: job.conclusion,
        runner_label: job.labels.join(','),
        runner_group: job.runner_group_name,
        runner_name: job.runner_name,
        queued_s: seconds(job.created_at, job.started_at),
        duration_s: duration,
        billable_minutes: billableMinutes,
        price_per_minute_usd: price,
        cost_usd:
          billableMinutes === 0
            ? 0
            : price == null
              ? null
              : Number((billableMinutes * price).toFixed(4)),
        job_url: job.html_url,
        steps: (job.steps ?? []).map(step => ({
          name: step.name,
          conclusion: step.conclusion,
          duration_s: seconds(step.started_at, step.completed_at)
        }))
      }
    }
  })

  const ran = jobs.filter(job => job.conclusion !== 'skipped')
  const costs = jobEvents.map(job => job.properties.cost_usd)
  return [
    ...jobEvents,
    {
      event: 'ci_run',
      distinct_id: 'ci',
      uuid: eventUuid(repo, run.id, run.run_attempt ?? 1, 'run'),
      timestamp: run.updated_at,
      properties: {
        ...runContext,
        conclusion: run.conclusion,
        duration_s: seconds(run.run_started_at, run.updated_at),
        jobs: jobs.length,
        jobs_skipped: jobs.length - ran.length,
        runner_minutes: Math.round(
          ran.reduce(
            (total, job) =>
              total + (seconds(job.started_at, job.completed_at) ?? 0),
            0
          ) / 60
        ),
        billable_minutes: jobEvents.reduce(
          (total, job) => total + job.properties.billable_minutes,
          0
        ),
        cost_usd: costs.some(cost => cost == null)
          ? null
          : Number(
              costs
                .reduce<number>((total, cost) => total + (cost ?? 0), 0)
                .toFixed(4)
            )
      }
    }
  ]
}
