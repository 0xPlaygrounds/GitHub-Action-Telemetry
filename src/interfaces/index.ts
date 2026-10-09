import type { components } from '@octokit/openapi-types'

export type WorkflowJobType = components['schemas']['job']
export type WorkflowRunType = components['schemas']['workflow-run']

// One line written by sampler.sh. Counters are cumulative; the post step uses differences.
export interface Sample {
  readonly t: number
  readonly user: number
  readonly system: number
  readonly idle: number
  readonly iowait: number
  readonly mem_used: number
  readonly swap_used: number
  readonly load1: number
  readonly disk_free: number
  readonly disk_used: number
  readonly disk_read: number
  readonly disk_write: number
  readonly net_rx: number
  readonly net_tx: number
}

// The usage between two samples, timed at the later one. Percentages are of all cores together.
export interface Interval {
  readonly t: number
  readonly seconds: number
  readonly cpu: number
  readonly user: number
  readonly system: number
  readonly iowait: number
  readonly memUsed: number
  readonly diskReadBytes: number
  readonly diskWriteBytes: number
  readonly netRxBytes: number
  readonly netTxBytes: number
}

export interface Usage {
  readonly cpu_avg_pct: number | null
  readonly cpu_p95_pct: number | null
  readonly cores_busy_avg: number | null
  readonly mem_peak_mb: number
  readonly disk_read_mb: number
  readonly disk_write_mb: number
  readonly net_rx_mb: number
  readonly net_tx_mb: number
}

export interface StepUsage extends Usage {
  readonly name: string
  readonly duration_s: number
}

export interface CompletedCommand {
  readonly name: string
  readonly pid: number
  readonly ppid: number
  readonly startTimeNs: number
  readonly fileName?: string
  readonly args: string[]
  readonly durationNs: number
  readonly exitCode: number
}

export interface ProcEventParseOptions {
  readonly minDurationMs: number
  readonly traceSystemProcesses: boolean
}
