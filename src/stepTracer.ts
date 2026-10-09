import type { StepUsage, WorkflowJobType } from './interfaces/index.js'

function generateTraceChartForSteps(job: WorkflowJobType): string {
  const lines = [
    'gantt',
    `\ttitle ${job.name}`,
    '\tdateFormat x',
    '\taxisFormat %H:%M:%S'
  ]
  for (const step of job.steps ?? []) {
    if (!step.started_at || !step.completed_at) continue
    let markers = ''
    if (step.name === 'Set up job' && step.number === 1)
      markers += 'milestone, '
    // crit shows red, done shows grey
    if (step.conclusion === 'failure') markers += 'crit, '
    else if (step.conclusion === 'skipped') markers += 'done, '
    const startTime = new Date(step.started_at).getTime()
    const finishTime = new Date(step.completed_at).getTime()
    lines.push(
      `\t${step.name.replace(/:/g, '-')} : ${markers}${Math.min(startTime, finishTime)}, ${finishTime}`
    )
  }
  return ['', '### Step Trace', '', '```mermaid', ...lines, '```'].join('\n')
}

function generateUsageTable(steps: StepUsage[], cores: number): string {
  if (!steps.length) return ''
  const cell = (value: number | null, unit = ''): string =>
    value == null ? '–' : `${value}${unit}`
  return [
    '',
    '### Step Resource Use',
    '',
    '| Step | Duration | Cores busy (avg) | CPU p95 | Peak RAM | Disk read / write | Network in / out |',
    '|---|---|---|---|---|---|---|',
    ...steps.map(
      step =>
        `| ${step.name.replace(/\|/g, '\\|')} | ${step.duration_s}s | ${cell(step.cores_busy_avg)} / ${cores} | ${cell(step.cpu_p95_pct, '%')} | ${step.mem_peak_mb} MB | ${step.disk_read_mb} / ${step.disk_write_mb} MB | ${step.net_rx_mb} / ${step.net_tx_mb} MB |`
    )
  ].join('\n')
}

export function report(
  job: WorkflowJobType,
  steps: StepUsage[],
  cores: number
): string {
  return `${generateTraceChartForSteps(job)}\n${generateUsageTable(steps, cores)}`
}
