import type {
  Interval,
  Sample,
  StepUsage,
  Usage,
  WorkflowJobType
} from './interfaces/index.js'

export const MB = 1024 * 1024
export const GB = 1024 * MB

export function round(
  value: number | null | undefined,
  digits = 1
): number | null {
  return value == null || Number.isNaN(value)
    ? null
    : Number(value.toFixed(digits))
}

export function average(values: number[]): number | null {
  return values.length
    ? values.reduce((total, value) => total + value, 0) / values.length
    : null
}

// Nearest-rank quantile: the smallest value with at least q of the values at or below it.
export function quantile(values: number[], q: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)]
}

export function parseSamples(text: string): Sample[] {
  return text.split('\n').flatMap(line => {
    try {
      return [JSON.parse(line) as Sample]
    } catch {
      return []
    }
  })
}

export function toIntervals(samples: Sample[]): Interval[] {
  return samples.slice(1).map((sample, index) => {
    const previous = samples[index]
    const user = sample.user - previous.user
    const system = sample.system - previous.system
    const iowait = sample.iowait - previous.iowait
    const total = user + system + iowait + (sample.idle - previous.idle)
    const percent = (value: number): number =>
      total ? (100 * value) / total : 0
    return {
      t: sample.t,
      seconds: Math.max(0.001, (sample.t - previous.t) / 1000),
      cpu: percent(user + system),
      user: percent(user),
      system: percent(system),
      iowait: percent(iowait),
      memUsed: sample.mem_used,
      diskReadBytes: Math.max(
        0,
        (sample.disk_read ?? 0) - (previous.disk_read ?? 0)
      ),
      diskWriteBytes: Math.max(
        0,
        (sample.disk_write ?? 0) - (previous.disk_write ?? 0)
      ),
      netRxBytes: Math.max(0, (sample.net_rx ?? 0) - (previous.net_rx ?? 0)),
      netTxBytes: Math.max(0, (sample.net_tx ?? 0) - (previous.net_tx ?? 0))
    }
  })
}

const sum = (intervals: Interval[], key: keyof Interval): number =>
  intervals.reduce((total, interval) => total + interval[key], 0)

export function usage(intervals: Interval[], cores: number): Usage {
  const cpu = intervals.map(interval => interval.cpu)
  const cpuAverage = average(cpu)
  return {
    cpu_avg_pct: round(cpuAverage),
    cpu_p95_pct: round(quantile(cpu, 0.95)),
    cores_busy_avg:
      cpuAverage == null ? null : round((cpuAverage * cores) / 100, 2),
    mem_peak_mb: Math.round(
      Math.max(0, ...intervals.map(interval => interval.memUsed)) / MB
    ),
    disk_read_mb: round(sum(intervals, 'diskReadBytes') / MB) ?? 0,
    disk_write_mb: round(sum(intervals, 'diskWriteBytes') / MB) ?? 0,
    net_rx_mb: round(sum(intervals, 'netRxBytes') / MB) ?? 0,
    net_tx_mb: round(sum(intervals, 'netTxBytes') / MB) ?? 0
  }
}

// The API can list a step that ended a moment ago without completed_at; the next step's start,
// or now, then marks its end. Post steps run after the job's work and are left out.
export function stepUsage(
  job: WorkflowJobType | undefined,
  intervals: Interval[],
  cores: number,
  now: number
): { steps: StepUsage[]; openSteps: string[] } {
  const jobSteps = (job?.steps ?? []).filter(
    step => step.started_at && !step.name.startsWith('Post ')
  )
  const openSteps = jobSteps
    .filter(step => !step.completed_at)
    .map(step => step.name)
  const steps = jobSteps.flatMap((step, index): StepUsage[] => {
    const next = jobSteps[index + 1]
    const start = Date.parse(step.started_at as string)
    const end =
      step.completed_at != null
        ? Date.parse(step.completed_at)
        : next?.started_at != null
          ? Date.parse(next.started_at)
          : now
    const inside = intervals.filter(
      interval => interval.t >= start && interval.t < end + 1000
    )
    if (!inside.length) return []
    return [
      {
        name: step.name,
        duration_s: Math.round((end - start) / 1000),
        ...usage(inside, cores)
      }
    ]
  })
  return { steps, openSteps }
}

// Bytes per second of one counter for each interval, in MB/s.
export function rates(intervals: Interval[], key: keyof Interval): number[] {
  return intervals.map(interval => interval[key] / MB / interval.seconds)
}
