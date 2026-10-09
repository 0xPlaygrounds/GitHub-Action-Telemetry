import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import * as core from '@actions/core'
import { lineChart } from './charts.js'
import type { Interval, Sample } from './interfaces/index.js'
import * as logger from './logger.js'
import { GB, MB, parseSamples, rates } from './usage.js'

const SAMPLER_PID_KEY = 'SAMPLER_PID'
const SAMPLES_FILE_KEY = 'SAMPLES_FILE'

export function start(): boolean {
  try {
    const samples = path.join(
      process.env.RUNNER_TEMP ?? '/tmp',
      'workflow-telemetry-samples.jsonl'
    )
    const frequency = Number.parseInt(core.getInput('metric_frequency'), 10)
    // The bundle runs as dist/main/index.js; the sampler is dist/sampler.sh.
    const sampler = path.join(path.dirname(process.argv[1]), '..', 'sampler.sh')
    const child = spawn(
      'bash',
      [
        sampler,
        samples,
        String(Number.isInteger(frequency) && frequency > 0 ? frequency : 5)
      ],
      { detached: true, stdio: 'ignore' }
    )
    child.unref()
    core.saveState(SAMPLER_PID_KEY, String(child.pid))
    core.saveState(SAMPLES_FILE_KEY, samples)
    logger.info(`Sampling resource use to ${samples} (pid ${child.pid})`)
    return true
  } catch (error) {
    logger.warning('Unable to start the resource sampler', error)
    return false
  }
}

export function finish(): Sample[] {
  const pid = Number(core.getState(SAMPLER_PID_KEY))
  try {
    if (pid) process.kill(-pid)
  } catch (error) {
    logger.debug(`Sampler already stopped: ${String(error)}`)
  }
  try {
    return parseSamples(readFileSync(core.getState(SAMPLES_FILE_KEY), 'utf8'))
  } catch (error) {
    logger.warning('Unable to read the resource samples', error)
    return []
  }
}

export function report(
  samples: Sample[],
  intervals: Interval[],
  memTotal: number
): string {
  if (!intervals.length) return ''
  const minutes = (samples[samples.length - 1].t - samples[0].t) / 60_000
  const later = samples.slice(1)
  const charts = [
    lineChart({
      title: 'CPU % of all cores',
      yLabel: '%',
      minutes,
      yMax: 100,
      series: [
        {
          name: 'busy',
          color: 'blue',
          values: intervals.map(interval => interval.cpu)
        },
        {
          name: 'I/O wait',
          color: 'red',
          values: intervals.map(interval => interval.iowait)
        }
      ]
    }),
    lineChart({
      title: 'Memory MB',
      yLabel: 'MB',
      minutes,
      yMax: Math.round(memTotal / MB),
      series: [
        {
          name: 'used',
          color: 'blue',
          values: later.map(sample => sample.mem_used / MB)
        },
        {
          name: 'swap used',
          color: 'red',
          values: later.map(sample => sample.swap_used / MB)
        }
      ]
    }),
    lineChart({
      title: 'Disk I/O MB/s',
      yLabel: 'MB/s',
      minutes,
      series: [
        {
          name: 'read',
          color: 'blue',
          values: rates(intervals, 'diskReadBytes')
        },
        {
          name: 'write',
          color: 'red',
          values: rates(intervals, 'diskWriteBytes')
        }
      ]
    }),
    lineChart({
      title: 'Network MB/s',
      yLabel: 'MB/s',
      minutes,
      series: [
        {
          name: 'received',
          color: 'blue',
          values: rates(intervals, 'netRxBytes')
        },
        { name: 'sent', color: 'red', values: rates(intervals, 'netTxBytes') }
      ]
    }),
    lineChart({
      title: 'Workspace disk GB',
      yLabel: 'GB',
      minutes,
      yMax: Math.ceil((later[0].disk_used + later[0].disk_free) / GB),
      series: [
        {
          name: 'used',
          color: 'blue',
          values: later.map(sample => sample.disk_used / GB)
        }
      ]
    })
  ].filter(Boolean)
  return [
    '',
    '### Resource Use',
    '',
    ...charts.flatMap(chart => [chart, ''])
  ].join('\n')
}
