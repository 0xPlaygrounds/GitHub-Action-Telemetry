# Runner rightsizing in PostHog: design

Status: draft for review. Date: 2026-10-09.

## Goal

Make this action the best way to see GitHub Actions CI in PostHog. Each CI topic uses the PostHog
product that fits it. This spec covers the first topic: **runner rightsizing**. It shows, for each
job, the duration and the cost on each runner label. It does not choose a label. A person reads
the trade-offs and decides.

### Success criteria

- A team can install the views and the canvas in a PostHog project with one command. The only
  changes to the events are two additive properties (`repo`, `job_key`).
- For each (job, label) pair, the view shows measured data, or an estimate that has a clear label.
- In the backtest, the median error of calibrated estimates is 20% or less.
- In Ryzome, the view is enough to make the larger-runner decision (`ubuntu-latest`,
  `blacksmith-4vcpu-ubuntu-2404`, `medium-berta-ubuntu-4vcpu`, `big-berta-ubuntu-8vcpu`).

### Not in scope

- Automatic recommendations or a rules engine.
- A button that creates a PostHog task to change a job's runner (`tasks.create`). The canvas can
  add it later.
- Other topics (see [Roadmap](#roadmap)). Each one gets its own spec.

## Inputs

v3 already sends almost all the inputs. This topic adds two properties, released as v3.1.0:

- **`repo`** (`owner/name`) on `ci_job_resources`, `ci_job` and `ci_run`. Without it, a project
  that gets data from more than one repo cannot separate jobs with the same names. Events from
  before v3.1.0 have no `repo`; the views use `''` for them, which is correct for a project that
  gets data from one repo only.
- **`job_key`** on `ci_job_resources`, from a new `job_key` input. It defaults to the job's id in
  its workflow file (`github.job`). The id stays the same when the job runs on another runner
  label or is called from another workflow, so a benchmark run of `lint-and-test` (job name
  `typescript (big-berta-ubuntu-8vcpu) / lint-and-test` in workflow "Runner benchmark") and a
  normal CI run of it (job name `lint-and-test`) get the same key. Set the input when a matrix
  runs one job id with different work. Events from before v3.1.0 use the job name.

All views group by `(repo, job_key)`. `ci_job_resources` and `ci_job` join on `job_id`.

| Event | Properties used |
|---|---|
| `ci_job_resources` | `repo`, `job_key`, `job`, `job_id`, `cpu_cores`, `cpu_model`, `mem_total_mb`, `mem_peak_mb`, `swap_peak_mb`, `iowait_avg_pct`, `steps[]` (`name`, `duration_s`, `cores_busy_avg`) |
| `ci_job` | `job_id`, `workflow`, `run_id`, `runner_label`, `conclusion`, `queued_s`, `duration_s`, `price_per_minute_usd`, `sha`, `event` |

A job appears in the views only when the `collect` action reports its workflow, because the
duration, price and conclusion come from `ci_job`.

`docs/events.md` documents these properties as a public contract. A change to a property name or
meaning is a breaking change and needs a new major version of the action.

## Architecture

```
GitHub-Action-Telemetry (v3.1)      PostHog project (saved SQL views)               PostHog Desktop
  ci_job_resources ─┐               ci_job_runs ─► ci_step_runs ─► ci_label_speed   ┌─ component
  ci_job           ─┼─► events ───► ci_job_runs ─► ci_label_profile                 │  "Runner trade-offs"
  ci_run           ─┘               ci_job_runs ─► ci_job_label_stats ─► ci_job_sources  ──►│
                                    ... ─► ci_step_tradeoffs ─► ci_job_tradeoffs     └─ grid canvas "CI runners"
```

Eight small saved SQL views. Each has one purpose and can be tested alone with fixture rows:

1. **`ci_job_runs`**: one row for each successful job run that sent `ci_job_resources`, joined to
   its `ci_job` event (duration, queue time, price, commit, trigger). Duplicate events collapse on
   `job_id`.
2. **`ci_step_runs`**: one row for each step of each run in `ci_job_runs`.
3. **`ci_label_profile`**: one row for each runner label seen in the window: `vcpus`,
   `mem_total_mb`, `cpu_model`, `price_per_minute_usd` (latest known), `queued_s_p50`, `runs`.
   Labels come from observed runs, so there is no catalog to keep by hand. A label must run at
   least once to be a candidate.
4. **`ci_label_speed`**: one per-core speed factor `k` for each label, relative to the baseline
   label (`k = 1.0`). See [Calibration](#calibration). A label with no pair has no row.
5. **`ci_job_label_stats`**: one row for each (job, label): runs, duration p50/p90, memory, swap,
   I/O wait, normal runs (not `workflow_dispatch`) and the time of the last normal run.
6. **`ci_job_sources`**: one row for each job: the source label (most runs), the current label
   (label of the last normal run), normal runs, and the workflow name to show.
7. **`ci_step_tradeoffs`**: one row for each (job, step, target label) with `t_s`, `c`, `w`, `p`
   and `estimate_s`. It holds the [formula](#formula).
8. **`ci_job_tradeoffs`**: one row for each (job, label): `duration_p50_s`, `duration_p90_s`,
   `cost_per_run_usd`, `unreliable`, `source` (`measured` | `calibrated` | `uncalibrated` |
   `does_not_fit`), `is_current_label`, `runs_per_month`, and the backtest columns. It holds the
   [rules](#rules-for-each-job-label-pair).

**Canvas component "Runner trade-offs".** It reads `ci_label_profile`, `ci_job_tradeoffs` and
`ci_step_tradeoffs`. It does no math other than formatting and marking the cost/time frontier.

The window (default 14 days) and the baseline label (default `ubuntu-latest`) are install options.
Saved views take no parameters, so the install script writes them into the SQL.

The views hold all the logic, so a team without canvases can use the views in normal insights.

## Estimate model

### Step inputs

For each job, the source label is the label that has the most successful runs in the window.
For each step of the job on the source label, the model takes the median over successful runs in
the window (default 14 days, configurable):

- `t`: step duration in seconds.
- `c`: average busy cores during the step (`cores_busy_avg`).
- `Nₛ`: vCPUs of the source label.

For the target label: `Nₜ` (vCPUs) and `kₜ` (per-core speed factor; `1.0` when null).

### Formula

```
w  = max(0, 1 − c)                     share of time with no CPU work (network, disk, waits)
p  = clamp((c − 1) / (Nₛ − 1), 0, 1)   parallel share, from how many cores the step used
t' = t × [ w + (1 − w) × ((1 − p) + p × Nₛ/Nₜ) × kₛ/kₜ ]
```

When `Nₛ = 1`, `p = 0`. The job estimate is the source label's median job duration plus the sum
of the step changes (`t' − t`), so the job time outside steps stays the same. A job with no step
data has no estimate. The cost per run is
`ceil(t'/60) × price_per_minute_usd` of the target label. Queue time is never estimated: the view
shows the measured `queued_s_p50` of each label.

### Rules for each (job, label) pair

Apply in this order:

1. **Measured:** the job has 3 or more successful runs on the label in the window. The view shows
   the p50 and p90 of the real durations and no estimate.
2. **Does not fit:** the job's median `mem_peak_mb` is more than 90% of the target's
   `mem_total_mb`. The view shows no duration.
3. **Calibrated:** the target and source labels both have a `k`.
4. **Uncalibrated:** one of the two labels has no `k`; the missing `k` is `1.0`.

**Unreliable flag** (on calibrated and uncalibrated rows): the source runs used swap
(`swap_peak_mb > 0`) or had `iowait_avg_pct > 20`.

### Calibration

For each label `L` other than the baseline: take pairs of the same step (`repo`, `run_id`,
`job_key`, step name) on the baseline and on `L`. Only a run that runs one job on several labels,
such as a runner-benchmark run, gives pairs, so the view needs no workflow name. Keep steps with
`c ≤ 1.2` on both labels and `t ≥ 20 s` on the baseline. Then:

```
k_L = median(t_baseline / t_L)
```

When a label has no such pair, `k_L` is null. The baseline label always has `k = 1.0`.

### Known bias

`c` is an average, so short bursts of parallel work look like serial work. Because of this, the
estimate gives too little gain on bigger runners for bursty steps such as `cargo build`.
Calibration does not fix this. Measured runs fix it. `docs/rightsizing.md` and the canvas header
say this.

### Backtest

For each (job, label) pair that is measured and where the label is not the job's source label,
and whose measured p50 is more than 0, the view also computes the estimate from the source label,
as if the pair had no runs. It gives `error_pct = (estimate − measured) / measured`.
The canvas header shows the median of `|error_pct|` for calibrated and for uncalibrated estimates.

## Canvas

- **Kind:** component "Runner trade-offs" (placement config: `repo` and `workflow`, both
  optional), placed in a grid canvas "CI runners". The install script writes the window and the
  baseline into a generated `src/settings.js` so the header can show them. Capabilities:
  `inlineQueries: true`, `state: ["user"]`, no events, no network origins, no actions.
- **Header:** window, baseline, backtest median error for calibrated and uncalibrated estimates,
  and the known-bias note.
- **Matrix:** rows = jobs grouped by workflow; columns = labels from `ci_label_profile`. Each cell
  shows the p50 duration, the cost per run, and the change against the job's current label. Cell
  style by `source`: solid = measured, outline = calibrated, dashed = uncalibrated, grey = does
  not fit, ⚠ = unreliable. The current label is marked.
- **Detail (click a row):**
  - Duration-versus-cost plot, one point for each label. Points on the cost/time frontier are
    marked.
  - Step table for a chosen label: `t`, `t'`, `c`, `w`, `p` for each step, sorted by the change.
  - Monthly line: `runs_per_month ×` the change in duration and in cost.
- **Verifiability:** each figure has a collapsed "Query" area with the exact SQL that ran.
- **Viewer state:** when the placement config sets no `workflow`, the viewer picks one, and the
  choice persists for each viewer (`ph.state` user scope).

## Errors and empty states

| Case | Result |
|---|---|
| Fewer than 3 runs on every label for a job | Row shows estimates only; empty-state hint: "Run the runner-benchmark workflow to measure this job" |
| No runs in the window at all | Empty state with the same hint and a link to the install docs |
| Label has no price | Cost cell shows "no price"; hint to set `runner_prices` in the `collect` action |
| Label has no `k` | Estimate is uncalibrated |
| Query error | The canvas shows the error and the query; it never shows an empty chart without a reason |

## Packaging

```
posthog/
  sql/*.sql                    the 8 views
  lib/sql.mjs                  SQL rendering, fixtures, view replacement
  lib/api.mjs                  PostHog API client
  lib/install.mjs              upsert of views, component and grid canvas
  canvas/runner-tradeoffs/     component source (canvas.tsx, view.js)
  install.mjs                  command line entry
  test/*.test.mjs              offline unit tests (vitest)
  checks/*.check.mjs           SQL checks through the PostHog query API (node:test)
docs/events.md                 event contract
docs/rightsizing.md            model, rules, known bias, how to calibrate
src/identity.ts, src/post.ts, src/collectEvents.ts   `repo` and `job_key` (v3.1.0)
```

- `node posthog/install.mjs --project <id> [--channel <id>] [--window-days 14]
  [--baseline ubuntu-latest]` with a personal API key (env `POSTHOG_PERSONAL_API_KEY`, host env
  `POSTHOG_HOST`, default `https://us.posthog.com`). It finds views and canvases by name and
  updates them, so a second run changes nothing. It changes no events. Without `--channel`, it
  installs the views only.
- The canvas API accepts personal API keys (scopes `canvas:read`, `canvas:write`); views need
  `warehouse_view:read` and `warehouse_view:write`; checks need `query:read`.
- The README gets a "Rightsizing in PostHog" section that links to `docs/rightsizing.md`.

## Testing

- **SQL checks.** Each view reads only from other views (or `events` for `ci_job_runs`).
  `posthog/checks/*.check.mjs` replace those views with fixed rows built with `arrayJoin`, run the
  real SQL file read-only through the PostHog query API, and compare the results with
  hand-computed values. `ci_job_runs` runs against `events` with `LIMIT 0` to check that it
  compiles. Cases:
  - a network step (`c = 0.2`): duration almost unchanged;
  - a single-threaded step (`c = 1`): changes only with `k`;
  - a parallel step (`c = Nₛ`): scales with `Nₛ/Nₜ`;
  - a memory misfit: `does_not_fit`;
  - swap used: `unreliable`;
  - a measured pair: `measured`, no estimate;
  - calibration: `k` from paired single-threaded steps;
  - a job with no step data: no estimate;
  - a measured p50 of 0: no backtest row.
  The test writes nothing to the project. A fork CI job runs it with a read-only personal API key
  stored as a secret; without the secret, the job is skipped.
- **Canvas.** The platform validates the project at publish time. Check by hand in PostHog Desktop.
- **Live acceptance (Ryzome):**
  0. Release v3.1.0 and pin it in the monorepo (set `job_key` for the matrix jobs of the Rust
     cache workflow).
  1. Install in the E2E/CI project.
  2. Run the runner-benchmark workflow once for the 4 labels.
  3. Make sure the calibrated backtest median error is 20% or less.
  4. Use the view for the larger-runner decision.

## Roadmap

Each topic gets its own spec, after this one ships.

| Topic | PostHog product |
|---|---|
| Actions analytics | Dashboard template on `ci_job` / `ci_run`: failure rate, p50/p95 duration, minutes, cost; alerts on p95 regressions |
| Test observability | Events for each test case from JUnit XML (vitest, cargo-nextest); failed tests in Error Tracking, one issue for each test, so a flaky test is an issue that reopens |
| Runner logs | PostHog Logs through OTLP, linked to run, job and step |
| Network per destination | eBPF proc-tracer extension; bytes for each destination and step |
| Docker analytics | BuildKit build history as events: duration, cache hit ratio, image size |
| Other outputs | OTLP export (a run as a trace, jobs and steps as spans, OTEL CI/CD semantic conventions) |
