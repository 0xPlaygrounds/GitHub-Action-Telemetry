import * as core from '@actions/core'
import * as github from '@actions/github'
import { DEFAULT_RUNNER_PRICES, buildEvents } from './collectEvents.js'
import type { WorkflowJobType } from './interfaces/index.js'
import { send } from './posthog.js'

async function run(): Promise<void> {
  const octokit = github.getOctokit(core.getInput('github_token'))
  const { repo } = github.context
  const runId = Number(core.getInput('run_id', { required: true }))
  const pricesInput = core.getInput('runner_prices')
  const prices = pricesInput
    ? (JSON.parse(pricesInput) as Record<string, number>)
    : DEFAULT_RUNNER_PRICES

  const { data: workflowRun } = await octokit.rest.actions.getWorkflowRun({
    ...repo,
    run_id: runId
  })
  const jobs: WorkflowJobType[] = []
  for (let page = 1; ; page++) {
    const { data } = await octokit.rest.actions.listJobsForWorkflowRunAttempt({
      ...repo,
      run_id: runId,
      attempt_number: workflowRun.run_attempt ?? 1,
      per_page: 100,
      page
    })
    jobs.push(...data.jobs)
    if (data.jobs.length < 100) break
  }

  const events = buildEvents(
    `${repo.owner}/${repo.repo}`,
    workflowRun,
    jobs,
    prices
  )
  const apiKey = core.getInput('posthog_api_key')
  if (!apiKey) {
    core.info(JSON.stringify(events, null, 2))
    return
  }
  await send(events, apiKey, core.getInput('posthog_host'))
  core.info(
    `Sent ${events.length} events for ${workflowRun.name} run ${workflowRun.id}.`
  )
}

run().catch(error =>
  core.setFailed(error instanceof Error ? error.message : String(error))
)
