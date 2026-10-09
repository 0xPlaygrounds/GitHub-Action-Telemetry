import type {
  CompletedCommand,
  ProcEventParseOptions
} from './interfaces/index.js'
import * as logger from './logger.js'

const SYS_PROCS_TO_BE_IGNORED: Set<string> = new Set([
  'awk',
  'basename',
  'cat',
  'cut',
  'date',
  'echo',
  'envsubst',
  'expr',
  'dirname',
  'grep',
  'head',
  'id',
  'ip',
  'ln',
  'ls',
  'lsblk',
  'mkdir',
  'mktemp',
  'mv',
  'ps',
  'readlink',
  'rm',
  'sed',
  'seq',
  'sh',
  'uname',
  'whoami'
])

// Parses the proc-tracer output: one JSON object per completed process.
export function parse(
  text: string,
  options: ProcEventParseOptions
): CompletedCommand[] {
  const minDurationNs =
    options.minDurationMs > 0 ? options.minDurationMs * 1e6 : -1
  const commands: CompletedCommand[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    try {
      const command = JSON.parse(line) as CompletedCommand
      if (command.durationNs < minDurationNs) continue
      if (
        !options.traceSystemProcesses &&
        SYS_PROCS_TO_BE_IGNORED.has(command.name)
      )
        continue
      commands.push({ ...command, args: command.args ?? [] })
    } catch (error) {
      logger.debug(
        `Unable to parse process trace event (${String(error)}): ${line}`
      )
    }
  }
  return commands.sort((left, right) => left.startTimeNs - right.startTimeNs)
}
