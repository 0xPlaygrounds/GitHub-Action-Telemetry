import { useEffect, useMemo, useState } from 'react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Heading,
  SkeletonText,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
} from '@posthog/quill'
import { AlertTriangle } from 'lucide-react'
import {
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { BASELINE_LABEL, WINDOW_DAYS } from './settings.js'
import {
  EMPTY_HINT,
  formatCost,
  formatDuration,
  formatPercent,
  frontier,
  percentChange,
  quote,
} from './view.js'

const config = (typeof ph !== 'undefined' && ph.config) || {}
// An older runtime without ph.state keeps the workflow choice for the session only.
const stateApi =
  typeof ph !== 'undefined' && ph.state && typeof ph.state.get === 'function' ? ph.state : null

const SOURCE_STYLE = {
  measured: 'border border-border bg-card',
  calibrated: 'border border-primary',
  uncalibrated: 'border border-dashed border-border',
  does_not_fit: 'border border-border bg-muted text-muted-foreground',
}

const SOURCE_TEXT = {
  measured: 'Measured: 3 or more runs on this label',
  calibrated: 'Estimate, calibrated with benchmark runs',
  uncalibrated: 'Estimate, not calibrated: no benchmark pair for this label',
  does_not_fit: 'Does not fit: the job needs more than 90% of this label’s memory',
}

function rowsFrom(result) {
  const columns = result?.columns ?? []
  return (result?.results ?? []).map((row) =>
    Object.fromEntries(columns.map((column, index) => [column, row[index]]))
  )
}

function useQuery(sql) {
  const [state, setState] = useState({ loading: Boolean(sql), error: null, rows: null })
  useEffect(() => {
    if (!sql) {
      setState({ loading: false, error: null, rows: null })
      return
    }
    let cancelled = false
    setState({ loading: true, error: null, rows: null })
    ph.query(sql, {}, { refresh: 300 })
      .then((result) => {
        if (!cancelled) setState({ loading: false, error: null, rows: rowsFrom(result) })
      })
      .catch((error) => {
        if (!cancelled) {
          setState({ loading: false, error: String(error?.message ?? error), rows: null })
        }
      })
    return () => {
      cancelled = true
    }
  }, [sql])
  return state
}

function conditions(workflow, extra = []) {
  const parts = [...extra]
  if (config.repo) parts.push(`repo = ${quote(config.repo)}`)
  if (workflow) parts.push(`workflow = ${quote(workflow)}`)
  return parts.length ? `WHERE ${parts.join(' AND ')}` : ''
}

const LABELS_SQL = `SELECT runner_label, vcpus, mem_total_mb, price_per_minute_usd, queued_s_p50, runs
FROM ci_label_profile AS profile
ORDER BY vcpus, runner_label`

const WORKFLOWS_SQL = () => `SELECT DISTINCT workflow
FROM ci_job_tradeoffs AS tradeoffs
${conditions(null)}
ORDER BY workflow`

const TRADEOFFS_SQL = (workflow) => `SELECT repo, workflow, job_key, runner_label, source_label, is_current_label, runs,
    source, duration_p50_s, duration_p90_s, cost_per_run_usd, unreliable, runs_per_month
FROM ci_job_tradeoffs AS tradeoffs
${conditions(workflow)}
ORDER BY workflow, job_key, runner_label`

const BACKTEST_SQL = () => `SELECT backtest_kind, quantile(0.5)(abs(backtest_error)) AS median_abs_error, count() AS pairs
FROM ci_job_tradeoffs AS tradeoffs
${conditions(null, ['backtest_kind IS NOT NULL'])}
GROUP BY backtest_kind`

const STEPS_SQL = (repo, jobKey, label) => `SELECT step_name, t_s, estimate_s, c, w, p
FROM ci_step_tradeoffs AS steps
WHERE repo = ${quote(repo)} AND job_key = ${quote(jobKey)} AND target_label = ${quote(label)}
ORDER BY abs(estimate_s - t_s) DESC`

function QueryDialog({ title, sql }) {
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" size="sm">Query</Button>} />
      <DialogContent className="w-[92vw] max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] overflow-auto whitespace-pre-wrap rounded bg-muted p-3 font-mono text-xs">
          {sql}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// Waits for every listed query before rendering children: the skeleton shows while any of them
// is loading, and the first one with an error wins over the rest so only one message shows.
function Status({ queries, children }) {
  if (queries.some((query) => query.state.loading)) return <SkeletonText lines={6} />
  const failed = queries.find((query) => query.state.error)
  if (failed) {
    return (
      <div className="space-y-2">
        <Text>
          Could not load {failed.title}: {failed.state.error}
        </Text>
        <QueryDialog title={failed.title} sql={failed.sql} />
      </div>
    )
  }
  return children
}

function Header({ backtest }) {
  const byKind = Object.fromEntries((backtest.rows ?? []).map((row) => [row.backtest_kind, row]))
  const describe = (kind) =>
    backtest.error
      ? 'unavailable (see the Backtest query)'
      : byKind[kind]?.median_abs_error != null
      ? `${Math.round(Number(byKind[kind].median_abs_error) * 100)}% (${byKind[kind].pairs} pairs)`
      : 'no pairs yet'
  return (
    <div className="space-y-1">
      <Heading size="xl">Runner trade-offs</Heading>
      <Text className="text-muted-foreground">
        Cell key: solid border measured, coloured border calibrated estimate, dashed border
        uncalibrated estimate, grey does not fit, ⚠ unreliable.
      </Text>
      <Text>
        Last {WINDOW_DAYS} days. Baseline label {BASELINE_LABEL}. Median estimate error: calibrated{' '}
        {describe('calibrated')}, uncalibrated {describe('uncalibrated')}.
      </Text>
      <Text className="text-muted-foreground">
        Estimates use the average busy cores of each step, so short bursts of parallel work look
        serial: bursty steps such as compiles gain more on bigger runners than estimated. Only
        measured runs remove this bias.
      </Text>
      <Text className="text-muted-foreground">
        The calibrated error uses the same benchmark runs as the per-core speed factors. It shows
        how well the formula transfers, not a fully independent test.
      </Text>
    </div>
  )
}

function Cell({ row, current, selected, onSelect }) {
  if (!row) return <TableCell>—</TableCell>
  const change = row.is_current_label ? null : percentChange(current?.duration_p50_s, row.duration_p50_s)
  return (
    <TableCell>
      <button
        type="button"
        title={SOURCE_TEXT[row.source]}
        onClick={onSelect}
        className={
          'w-full rounded p-2 text-left ' +
          SOURCE_STYLE[row.source] +
          (selected ? ' ring-2 ring-primary' : '')
        }
      >
        <div className="flex items-center gap-1">
          {Number(row.unreliable) ? <AlertTriangle size={12} /> : null}
          <span className="font-medium">
            {row.source === 'does_not_fit' ? 'does not fit' : formatDuration(row.duration_p50_s)}
          </span>
          {Number(row.is_current_label) ? <Badge>current</Badge> : null}
        </div>
        <div className="text-xs text-muted-foreground">
          {row.source === 'does_not_fit' ? '' : formatCost(row.cost_per_run_usd)} {formatPercent(change)}
        </div>
      </button>
    </TableCell>
  )
}

function Plot({ rows }) {
  const points = rows
    .filter((row) => row.duration_p50_s != null && row.cost_per_run_usd != null)
    .map((row) => ({
      label: row.runner_label,
      duration: Number(row.duration_p50_s),
      cost: Number(row.cost_per_run_usd),
    }))
  const best = frontier(points)
  const shown = points.map((point) => ({
    ...point,
    name: best.has(point.label) ? `${point.label} ★` : point.label,
  }))
  if (!shown.length) return <Text>No label has both a duration and a price.</Text>
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 16, right: 24, bottom: 16, left: 8 }}>
          <CartesianGrid />
          <XAxis type="number" dataKey="cost" name="Cost per run" unit=" $" />
          <YAxis type="number" dataKey="duration" name="Duration" unit=" s" />
          <Tooltip />
          <Scatter data={shown}>
            <LabelList dataKey="name" position="top" />
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
      <Text className="text-muted-foreground">★ no other label is both faster and cheaper.</Text>
    </div>
  )
}

function Detail({ job, rows, label, onLabel }) {
  const sql = label ? STEPS_SQL(job.repo, job.job_key, label) : null
  const steps = useQuery(sql)
  const current = rows.find((row) => Number(row.is_current_label))
  const chosen = rows.find((row) => row.runner_label === label)
  const monthly =
    current && chosen && chosen.duration_p50_s != null && current.duration_p50_s != null
      ? {
          minutes:
            (Number(job.runs_per_month) * (chosen.duration_p50_s - current.duration_p50_s)) / 60,
          cost:
            chosen.cost_per_run_usd != null && current.cost_per_run_usd != null
              ? Number(job.runs_per_month) * (chosen.cost_per_run_usd - current.cost_per_run_usd)
              : null,
        }
      : null
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>
          {job.workflow} / {job.job_key}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Plot rows={rows} />
        <div className="flex flex-wrap gap-2">
          {rows.map((row) => (
            <Button
              key={row.runner_label}
              size="sm"
              variant={row.runner_label === label ? 'default' : 'outline'}
              onClick={() => onLabel(row.runner_label)}
            >
              {row.runner_label}
            </Button>
          ))}
        </div>
        {monthly ? (
          <Text>
            Moving {Math.round(Number(job.runs_per_month))} runs a month from {current.runner_label} to{' '}
            {label}: {monthly.minutes >= 0 ? '+' : ''}
            {Math.round(monthly.minutes)} min,{' '}
            {monthly.cost == null ? 'cost unknown' : `${monthly.cost >= 0 ? '+' : '-'}$${Math.abs(monthly.cost).toFixed(2)}`}{' '}
            a month.
          </Text>
        ) : null}
        {label ? (
          <Status queries={[{ state: steps, sql, title: 'step estimates' }]}>
            <div className="flex justify-end">
              <QueryDialog title="Step estimates" sql={sql} />
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Step</TableHead>
                  <TableHead>t</TableHead>
                  <TableHead>t′ on {label}</TableHead>
                  <TableHead>busy cores c</TableHead>
                  <TableHead>idle share w</TableHead>
                  <TableHead>parallel share p</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(steps.rows ?? []).map((step) => (
                  <TableRow key={step.step_name}>
                    <TableCell>{step.step_name}</TableCell>
                    <TableCell>{formatDuration(step.t_s)}</TableCell>
                    <TableCell>{formatDuration(step.estimate_s)}</TableCell>
                    <TableCell>{Number(step.c).toFixed(2)}</TableCell>
                    <TableCell>{Number(step.w).toFixed(2)}</TableCell>
                    <TableCell>{Number(step.p).toFixed(2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Status>
        ) : null}
      </CardContent>
    </Card>
  )
}

export default function RunnerTradeoffs() {
  const [workflow, setWorkflow] = useState(config.workflow ?? null)
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    if (config.workflow || !stateApi) return
    stateApi
      .get('workflow', { scope: 'user' })
      .then((value) => {
        if (typeof value === 'string') setWorkflow(value)
      })
      .catch(() => {})
  }, [])

  const chooseWorkflow = (value) => {
    const next = value || null
    setWorkflow(next)
    setSelected(null)
    if (stateApi) stateApi.set('workflow', next, { scope: 'user' }).catch(() => {})
  }

  const labelsSql = LABELS_SQL
  const workflowsSql = config.workflow ? null : WORKFLOWS_SQL()
  const tradeoffsSql = TRADEOFFS_SQL(workflow)
  const backtestSql = BACKTEST_SQL()
  const labels = useQuery(labelsSql)
  const workflows = useQuery(workflowsSql)
  const tradeoffs = useQuery(tradeoffsSql)
  const backtest = useQuery(backtestSql)

  // Drops a saved workflow the list no longer has (renamed or gone), so the dropdown does not
  // get stuck on a value it never shows and the query does not filter on it forever.
  useEffect(() => {
    if (!workflowsSql || workflows.loading || workflows.error || !workflow) return
    if ((workflows.rows ?? []).some((row) => row.workflow === workflow)) return
    setWorkflow(null)
    setSelected(null)
    if (stateApi) stateApi.set('workflow', null, { scope: 'user' }).catch(() => {})
  }, [workflowsSql, workflows.loading, workflows.error, workflows.rows, workflow])

  const jobs = useMemo(() => {
    const byJob = new Map()
    for (const row of tradeoffs.rows ?? []) {
      const key = `${row.repo}\u0000${row.job_key}`
      if (!byJob.has(key)) byJob.set(key, { ...row, cells: {} })
      byJob.get(key).cells[row.runner_label] = row
    }
    return [...byJob.values()]
  }, [tradeoffs.rows])

  const selectedJob = jobs.find((job) => `${job.repo}\u0000${job.job_key}` === selected?.job)

  return (
    <div className="flex min-h-screen flex-col gap-3 bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Header backtest={backtest} />
        <div className="flex items-center gap-2">
          {workflowsSql ? (
            <select
              className="rounded border border-border bg-card p-1 text-sm"
              value={workflow ?? ''}
              onChange={(event) => chooseWorkflow(event.target.value)}
            >
              <option value="">All workflows</option>
              {(workflows.rows ?? []).map((row) => (
                <option key={row.workflow} value={row.workflow}>
                  {row.workflow}
                </option>
              ))}
            </select>
          ) : null}
          {workflowsSql && workflows.error ? (
            <Text className="text-muted-foreground">Could not load workflows</Text>
          ) : null}
          {workflowsSql ? <QueryDialog title="Workflows" sql={workflowsSql} /> : null}
          <QueryDialog title="Trade-offs" sql={tradeoffsSql} />
          <QueryDialog title="Backtest" sql={backtestSql} />
          <QueryDialog title="Runner labels" sql={labelsSql} />
        </div>
      </div>

      <Card size="sm">
        <CardContent>
          <Status
            queries={[
              { state: labels, sql: labelsSql, title: 'runner labels' },
              { state: tradeoffs, sql: tradeoffsSql, title: 'trade-offs' },
            ]}
          >
            {!jobs.length ? (
              <Text>{workflow ? `No runs of workflow ${workflow} in the window.` : EMPTY_HINT}</Text>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Job</TableHead>
                      {(labels.rows ?? []).map((label) => (
                        <TableHead key={label.runner_label}>
                          <div>{label.runner_label}</div>
                          <div className="text-xs font-normal text-muted-foreground">
                            {label.vcpus} vCPU · {Math.round(Number(label.mem_total_mb) / 1024)} GB ·{' '}
                            {label.price_per_minute_usd == null
                              ? 'no price: set runner_prices in the collect action'
                              : `$${Number(label.price_per_minute_usd).toFixed(3)}/min`}{' '}
                            · queue {formatDuration(label.queued_s_p50)}
                          </div>
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {jobs.map((job) => {
                      const key = `${job.repo}\u0000${job.job_key}`
                      const current = Object.values(job.cells).find((row) => Number(row.is_current_label))
                      const measured = Object.values(job.cells).some((row) => row.source === 'measured')
                      return (
                        <TableRow key={key}>
                          <TableCell>
                            <div className="font-medium">{job.job_key}</div>
                            <div className="text-xs text-muted-foreground">{job.workflow}</div>
                            {measured ? null : (
                              <div className="text-xs text-muted-foreground">
                                Run the runner-benchmark workflow to measure this job.
                              </div>
                            )}
                          </TableCell>
                          {(labels.rows ?? []).map((label) => (
                            <Cell
                              key={label.runner_label}
                              row={job.cells[label.runner_label]}
                              current={current}
                              selected={selected?.job === key && selected?.label === label.runner_label}
                              onSelect={() => setSelected({ job: key, label: label.runner_label })}
                            />
                          ))}
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </Status>
        </CardContent>
      </Card>

      {selectedJob ? (
        <Detail
          job={selectedJob}
          rows={(labels.rows ?? [])
            .map((label) => selectedJob.cells[label.runner_label])
            .filter(Boolean)}
          label={selected.label}
          onLabel={(label) => setSelected({ ...selected, label })}
        />
      ) : null}
    </div>
  )
}
