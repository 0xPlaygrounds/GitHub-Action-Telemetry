import * as core from '@actions/core'

const LOG_HEADER = '[Workflow Telemetry]'

export function isDebugEnabled(): boolean {
  return core.isDebug()
}

export function debug(msg: string): void {
  core.debug(`${LOG_HEADER} ${msg}`)
}

export function info(msg: string): void {
  core.info(`${LOG_HEADER} ${msg}`)
}

// The action reports problems as warnings, so telemetry never fails the job it measures.
export function warning(msg: string, error?: unknown): void {
  const detail =
    error instanceof Error
      ? `: ${error.message}`
      : error == null
        ? ''
        : `: ${JSON.stringify(error)}`
  core.warning(`${LOG_HEADER} ${msg}${detail}`)
}
