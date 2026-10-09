import { execFileSync, spawn } from 'node:child_process'
import { existsSync, openSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as core from '@actions/core'
import type { CompletedCommand } from './interfaces/index.js'
import * as logger from './logger.js'
import { parse } from './procTraceParser.js'

const PROC_TRACER_PID_KEY = 'PROC_TRACER_PID'
const PROC_TRACER_OUTPUT_KEY = 'PROC_TRACER_OUTPUT'
const DEFAULT_PROC_TRACE_CHART_MAX_COUNT = 100
const GHA_FILE_NAME_PREFIX = '/home/runner/work/_actions/'

export function isEnabled(): boolean {
  return core.getInput('proc_trace_enable') === 'true'
}

// One CO-RE binary per CPU architecture runs on any kernel that exposes BTF type information.
function binaryPath(): string | null {
  const binary = path.join(
    path.dirname(process.argv[1]),
    '..',
    'proc-tracer',
    `proc-tracer-${os.arch()}`
  )
  if (!existsSync(binary)) {
    logger.info(
      `Process tracing disabled: no proc-tracer binary for ${os.arch()}`
    )
    return null
  }
  if (!existsSync('/sys/kernel/btf/vmlinux')) {
    logger.info(
      'Process tracing disabled: the kernel has no BTF type information'
    )
    return null
  }
  return binary
}

function getExtraProcessInfo(command: CompletedCommand): string | null {
  // Check whether this is node process with args
  if (command.name === 'node' && command.args.length > 1) {
    const arg1 = command.args[1]
    // Check whether this is Node.js GHA process
    if (arg1.startsWith(GHA_FILE_NAME_PREFIX)) {
      const actionFile = arg1.substring(GHA_FILE_NAME_PREFIX.length)
      const idx1 = actionFile.indexOf('/')
      const idx2 = actionFile.indexOf('/', idx1 + 1)
      if (idx1 >= 0 && idx2 > idx1) {
        // If we could find a valid GHA name, use it as extra info
        return actionFile.substring(idx1 + 1, idx2)
      }
    }
  }
  return null
}

export async function start(): Promise<boolean> {
  const binary = binaryPath()
  if (!binary) return false
  try {
    const temp = process.env.RUNNER_TEMP ?? '/tmp'
    const output = path.join(temp, 'workflow-telemetry-proc-trace.jsonl')
    const log = path.join(temp, 'workflow-telemetry-proc-tracer.log')
    const logFd = openSync(log, 'w')
    const child = spawn(
      'sudo',
      ['-n', binary, '--format', 'json', '--output', output],
      {
        detached: true,
        stdio: ['ignore', logFd, logFd]
      }
    )
    child.unref()
    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 100))
      if (readFileSync(log, 'utf8').includes('starting tracer')) {
        core.saveState(PROC_TRACER_PID_KEY, String(child.pid))
        core.saveState(PROC_TRACER_OUTPUT_KEY, output)
        logger.info(`Started process tracer (pid ${child.pid})`)
        return true
      }
      if (child.exitCode != null) break
    }
    logger.warning(
      `Process tracer did not start: ${readFileSync(log, 'utf8').slice(-500)}`
    )
    return false
  } catch (error) {
    logger.warning('Unable to start process tracer', error)
    return false
  }
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // The tracer runs as root, so a live process answers EPERM.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export async function finish(options: {
  minDurationMs: number
  traceSystemProcesses: boolean
}): Promise<CompletedCommand[] | null> {
  const pid = Number(core.getState(PROC_TRACER_PID_KEY))
  if (!pid) return null
  try {
    execFileSync('sudo', ['-n', 'kill', '-s', 'INT', String(pid)])
    for (let attempt = 0; attempt < 30 && isRunning(pid); attempt++) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    return parse(
      readFileSync(core.getState(PROC_TRACER_OUTPUT_KEY), 'utf8'),
      options
    )
  } catch (error) {
    logger.warning('Unable to finish process tracer', error)
    return null
  }
}

// proc-tracer reports CLOCK_MONOTONIC times; process.hrtime uses the same clock.
function toEpochMs(monotonicNs: number): number {
  const offsetMs = Date.now() - Number(process.hrtime.bigint() / 1_000_000n)
  return Math.round(offsetMs + monotonicNs / 1e6)
}

export function topProcesses(
  commands: CompletedCommand[],
  count: number
): { name: string; duration_s: number; exit_code: number }[] {
  return [...commands]
    .sort((left, right) => right.durationNs - left.durationNs)
    .slice(0, count)
    .map(command => ({
      name: getExtraProcessInfo(command) ?? command.name,
      duration_s: Number((command.durationNs / 1e9).toFixed(1)),
      exit_code: command.exitCode
    }))
}

export function report(jobName: string, commands: CompletedCommand[]): string {
  const chartShow = core.getInput('proc_trace_chart_show') !== 'false'
  const maxCountInput = Number.parseInt(
    core.getInput('proc_trace_chart_max_count'),
    10
  )
  const maxCount = Number.isInteger(maxCountInput)
    ? maxCountInput
    : DEFAULT_PROC_TRACE_CHART_MAX_COUNT
  const tableShow = core.getInput('proc_trace_table_show') === 'true'
  const items = ['', '### Process Trace']

  if (chartShow) {
    const lines = [
      'gantt',
      `\ttitle ${jobName}`,
      '\tdateFormat x',
      '\taxisFormat %H:%M:%S'
    ]
    const top = [...commands]
      .sort((left, right) => right.durationNs - left.durationNs)
      .slice(0, maxCount)
      .sort((left, right) => left.startTimeNs - right.startTimeNs)
    for (const command of top) {
      const extra = getExtraProcessInfo(command)
      const name = command.name.replace(/:/g, '#colon;')
      const start = toEpochMs(command.startTimeNs)
      const end = toEpochMs(command.startTimeNs + command.durationNs)
      // crit shows red
      lines.push(
        `\t${extra ? `${name} (${extra})` : name} : ${command.exitCode !== 0 ? 'crit, ' : ''}${start}, ${end}`
      )
    }
    items.push(
      '',
      `#### Top ${maxCount} processes with highest duration`,
      '',
      '```mermaid',
      ...lines,
      '```'
    )
  }

  if (tableShow) {
    const header = [
      'NAME'.padEnd(16),
      'PID'.padStart(7),
      'PPID'.padStart(7),
      'START (s)'.padStart(10),
      'DURATION (ms)'.padStart(14),
      'EXIT'.padStart(5),
      'ARGS'
    ].join(' ')
    const first = commands[0]?.startTimeNs ?? 0
    const rows = commands.map(command =>
      [
        command.name.padEnd(16),
        String(command.pid).padStart(7),
        String(command.ppid).padStart(7),
        ((command.startTimeNs - first) / 1e9).toFixed(1).padStart(10),
        String(Math.round(command.durationNs / 1e6)).padStart(14),
        String(command.exitCode).padStart(5),
        command.args.join(' ')
      ].join(' ')
    )
    items.push(
      '',
      '#### All processes with detail',
      '',
      '```',
      header,
      ...rows,
      '```'
    )
  }

  return items.join('\n')
}
