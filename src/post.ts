import * as core from '@actions/core'
import * as github from '@actions/github'
import type { CompletedCommand, WorkflowJobType } from './interfaces/index.js'
import { jobIdentity } from './identity.js'
import * as logger from './logger.js'
import { machine, sccacheStats } from './machine.js'
import { eventUuid, send } from './posthog.js'
import * as processTracer from './processTracer.js'
import * as statCollector from './statCollector.js'
import * as stepTracer from './stepTracer.js'
import {
  GB,
  average,
  quantile,
  rates,
  round,
  stepUsage,
  toIntervals,
  usage
} from './usage.js'

const PAGE_SIZE = 100

async function getCurrentJob(): Promise<WorkflowJobType | undefined> {
  const octokit = github.getOctokit(core.getInput('github_token'))
  const { repo, runId } = github.context
  const attempt = Number(process.env.GITHUB_RUN_ATTEMPT ?? 1)
  const findJob = async (): Promise<WorkflowJobType | undefined> => {
    for (let page = 1; ; page++) {
      const { data } = await octokit.rest.actions.listJobsForWorkflowRunAttempt(
        {
          ...repo,
          run_id: runId,
          attempt_number: attempt,
          per_page: PAGE_SIZE,
          page
        }
      )
      const job = data.jobs.find(
        candidate =>
          candidate.status === 'in_progress' &&
          candidate.runner_name === process.env.RUNNER_NAME
      )
      if (job || data.jobs.length < PAGE_SIZE) return job
    }
  }
  try {
    for (let retry = 0; retry < 10; retry++) {
      const job = await findJob()
      if (job) return job
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
    logger.warning(
      'Could not find this job in the GitHub API; steps are not reported'
    )
  } catch (error) {
    logger.warning(
      'Unable to read this job from the GitHub API (needs actions: read)',
      error
    )
  }
  return undefined
}

async function publish(
  job: WorkflowJobType | undefined,
  content: string
): Promise<void> {
  const { repo, runId, sha, workflow, payload } = github.context
  const pullRequest = payload.pull_request
  const commit = (pullRequest?.head as { sha?: string } | undefined)?.sha ?? sha
  const jobUrl =
    job?.html_url ??
    `https://github.com/${repo.owner}/${repo.repo}/actions/runs/${runId}`
  const body = [
    `## Workflow Telemetry - ${workflow} / ${job?.name ?? github.context.job}`,
    `Workflow telemetry for commit [${commit}](https://github.com/${repo.owner}/${repo.repo}/commit/${commit})`,
    `You can access workflow job details [here](${jobUrl})`,
    content
  ].join('\n')

  if (core.getInput('job_summary') !== 'false') {
    await core.summary.addRaw(body).write()
  }
  if (pullRequest && core.getInput('comment_on_pr') === 'true') {
    await github
      .getOctokit(core.getInput('github_token'))
      .rest.issues.createComment({
        ...repo,
        issue_number: pullRequest.number,
        body
      })
  }
}

async function run(): Promise<void> {
  logger.info('Finishing ...')
  const samples = statCollector.finish()
  const commands: CompletedCommand[] | null = processTracer.isEnabled()
    ? await processTracer.finish({
        minDurationMs:
          Number.parseInt(core.getInput('proc_trace_min_duration'), 10) || -1,
        traceSystemProcesses: core.getInput('proc_trace_sys_enable') === 'true'
      })
    : null
  const job = await getCurrentJob()

  const facts = machine()
  const intervals = toIntervals(samples)
  const { steps, openSteps } = stepUsage(
    job,
    intervals,
    facts.cpu_cores,
    Date.now()
  )

  const sections: string[] = []
  if (job) sections.push(stepTracer.report(job, steps, facts.cpu_cores))
  sections.push(
    statCollector.report(samples, intervals, facts.mem_total_mb * 1024 * 1024)
  )
  if (commands)
    sections.push(
      processTracer.report(job?.name ?? github.context.job, commands)
    )
  try {
    await publish(job, sections.join('\n'))
  } catch (error) {
    logger.warning('Unable to publish the telemetry report', error)
  }

  if (!intervals.length) {
    logger.info('Not enough samples to report resource use')
    return
  }

  const cpu = intervals.map(interval => interval.cpu)
  const memPeak = Math.max(...samples.map(sample => sample.mem_used))
  const properties = {
    $process_person_profile: false,
    ...jobIdentity(
      github.context.repo.owner,
      github.context.repo.repo,
      core.getInput('job_key'),
      github.context.job,
      process.env.GITHUB_WORKFLOW_REF ?? ''
    ),
    workflow: github.context.workflow,
    job: job?.name ?? github.context.job,
    job_id: job?.id ?? null,
    run_id: github.context.runId,
    run_attempt: Number(process.env.GITHUB_RUN_ATTEMPT ?? 1),
    runner_label: job?.labels?.join(',') ?? null,
    runner_name: process.env.RUNNER_NAME ?? null,
    ...facts,
    ...usage(intervals, facts.cpu_cores),
    cores_busy_p95: round(
      ((quantile(cpu, 0.95) ?? 0) * facts.cpu_cores) / 100,
      2
    ),
    iowait_avg_pct: round(average(intervals.map(interval => interval.iowait))),
    load1_max: Math.max(...samples.map(sample => sample.load1)),
    mem_peak_pct: round((100 * memPeak) / (facts.mem_total_mb * 1024 * 1024)),
    swap_peak_mb: Math.round(
      Math.max(...samples.map(sample => sample.swap_used)) / 1024 / 1024
    ),
    disk_free_min_gb: round(
      Math.min(...samples.map(sample => sample.disk_free)) / GB
    ),
    disk_read_mbps_p95: round(
      quantile(rates(intervals, 'diskReadBytes'), 0.95)
    ),
    disk_write_mbps_p95: round(
      quantile(rates(intervals, 'diskWriteBytes'), 0.95)
    ),
    sampled_s: Math.round(
      (samples[samples.length - 1].t - samples[0].t) / 1000
    ),
    ...sccacheStats(),
    ...(commands
      ? { top_processes: processTracer.topProcesses(commands, 10) }
      : {}),
    steps
  }
  const event = {
    event: 'ci_job_resources',
    distinct_id: 'ci',
    uuid: eventUuid(
      `${github.context.repo.owner}/${github.context.repo.repo}`,
      github.context.runId,
      properties.run_attempt,
      job?.id ?? properties.runner_name ?? github.context.job,
      'resources'
    ),
    timestamp: new Date(samples[samples.length - 1].t).toISOString(),
    properties
  }

  const apiKey = core.getInput('posthog_api_key')
  if (!apiKey) {
    logger.info(
      `No posthog_api_key; ci_job_resources event:\n${JSON.stringify(event, null, 2)}`
    )
    return
  }
  try {
    await send([event], apiKey, core.getInput('posthog_host'))
    logger.info(
      `Sent resource use for ${properties.job}: ${steps.map(step => step.name).join(', ')}.` +
        (openSteps.length
          ? ` No end time in the API yet: ${openSteps.join(', ')}.`
          : '')
    )
  } catch (error) {
    logger.warning('Unable to send resource use to PostHog', error)
  }
}

run().catch(error => logger.warning('Finishing failed', error))
