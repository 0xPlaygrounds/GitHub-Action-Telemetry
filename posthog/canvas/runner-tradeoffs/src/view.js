export const EMPTY_HINT =
  'No job runs in the window. A job shows here when the workflow telemetry action runs in it and ' +
  'the collect action reports its workflow. Run the runner-benchmark workflow to measure jobs on ' +
  'more runner labels.'

export function quote(value) {
  return `'${String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`
}

export function percentChange(from, to) {
  if (from == null || to == null || Number(from) === 0) return null
  return (Number(to) - Number(from)) / Number(from)
}

// A label is on the frontier when no other label is at least as fast and as cheap, and better in
// one of the two. Labels without a duration or a cost are not compared.
export function frontier(points) {
  const usable = points.filter(
    point => point.duration != null && point.cost != null
  )
  const beaten = point =>
    usable.some(
      other =>
        other !== point &&
        other.duration <= point.duration &&
        other.cost <= point.cost &&
        (other.duration < point.duration || other.cost < point.cost)
    )
  return new Set(
    usable.filter(point => !beaten(point)).map(point => point.label)
  )
}

export function formatDuration(seconds) {
  if (seconds == null) return '—'
  const total = Math.round(Number(seconds))
  if (total < 60) return `${total}s`
  return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, '0')}s`
}

export function formatCost(usd) {
  return usd == null ? 'no price' : `$${Number(usd).toFixed(3)}`
}

export function formatPercent(fraction) {
  if (fraction == null) return ''
  const percent = Math.round(fraction * 100)
  return `${percent > 0 ? '+' : ''}${percent}%`
}
