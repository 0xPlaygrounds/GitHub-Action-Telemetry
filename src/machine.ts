import { execFileSync } from 'node:child_process'
import { statfsSync } from 'node:fs'
import os from 'node:os'
import { GB, MB, round } from './usage.js'

export interface Machine {
  readonly cpu_cores: number
  readonly cpu_model: string | null
  readonly arch: string
  readonly mem_total_mb: number
  readonly disk_total_gb: number | null
}

export function machine(): Machine {
  let diskTotal: number | null
  try {
    const root = statfsSync('/')
    diskTotal = round((root.blocks * root.bsize) / GB)
  } catch {
    diskTotal = null
  }
  return {
    cpu_cores: os.availableParallelism(),
    cpu_model: os.cpus()[0]?.model?.trim() ?? null,
    arch: os.arch(),
    mem_total_mb: Math.round(os.totalmem() / MB),
    disk_total_gb: diskTotal
  }
}

interface SccacheStats {
  stats?: {
    cache_hits?: { counts?: Record<string, number> }
    cache_misses?: { counts?: Record<string, number> }
  }
}

// Present only when the job used sccache.
export function sccacheStats(): Record<string, number> {
  try {
    const { stats } = JSON.parse(
      execFileSync('sccache', ['--show-stats', '--stats-format', 'json'], {
        encoding: 'utf8',
        timeout: 10_000,
        stdio: ['ignore', 'pipe', 'ignore']
      })
    ) as SccacheStats
    const total = (counts?: Record<string, number>): number =>
      Object.values(counts ?? {}).reduce((sum, count) => sum + count, 0)
    const hits = total(stats?.cache_hits?.counts)
    const misses = total(stats?.cache_misses?.counts)
    if (!hits && !misses) return {}
    return {
      sccache_hits: hits,
      sccache_misses: misses,
      sccache_hit_rate: Number((hits / (hits + misses)).toFixed(3))
    }
  } catch {
    return {}
  }
}
