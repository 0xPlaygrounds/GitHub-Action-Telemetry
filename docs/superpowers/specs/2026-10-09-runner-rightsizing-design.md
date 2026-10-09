# Runner rightsizing in PostHog: design

Status: draft for review. Date: 2026-10-09.

## Goal

Make this action the best way to see GitHub Actions CI in PostHog. Each CI topic uses the PostHog
product that fits it. This spec covers the first topic: **runner rightsizing**. It shows, for each
job, the duration and the cost on each runner label. It does not choose a label. A person reads
the trade-offs and decides.

### Success criteria

- A team can install the views and the canvas in a PostHog project with one command. The only
  change to the events is one additive property (`repo`).
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

v3 already sends almost all the inputs. This topic adds one property: **`repo`**
(`owner/name`) on `ci_job_resources`, `ci_job` and `ci_run`, released as v3.1.0. Without it, a
project that gets data from more than one repo cannot separate jobs with the same workflow and job
names. Events from before v3.1.0 have no `repo`; the views treat them as `repo = null`, which is
correct for a project that gets data from one repo only. All views group by
`(repo, workflow, job)`.

| Event | Properties used |
|---|---|
| `ci_job_resources` | `repo`, `workflow`, `job`, `run_id`, `run_attempt`, `runner_label`, `cpu_cores`, `cpu_model`, `mem_total_mb`, `mem_peak_mb`, `swap_peak_mb`, `iowait_avg_pct`, `steps[]` (`name`, `duration_s`, `cores_busy_avg`) |
| `ci_job` | `repo`, `workflow`, `job`, `run_id`, `run_attempt`, `runner_label`, `conclusion`, `queued_s`, `duration_s`, `price_per_minute_usd`, `sha`, `event` |

`docs/events.md` documents these properties as a public contract. A change to a property name or
meaning is a breaking change and needs a new major version of the action.

## Architecture

```
GitHub-Action-Telemetry (v3)        PostHog project                      PostHog Desktop
  ci_job_resources ─┐               ┌─ view ci_label_profile             ┌─ component
  ci_job           ─┼─► events ────►├─ view ci_label_speed            ──►│  "Runner trade-offs"
  ci_run           ─┘               └─ view ci_job_tradeoffs             └─ in grid canvas "CI runners"
```

Each unit has one purpose:

1. **`ci_label_profile`** (saved SQL view). One row for each runner label seen in the window:
   `vcpus`, `mem_total_mb`, `cpu_model`, `price_per_minute_usd`, `queued_s_p50`, `runs`. Labels
   come from observed runs, so there is no catalog to keep by hand. A label must run at least once
   to be a candidate.
2. **`ci_label_speed`** (saved SQL view). One per-core speed factor `k` for each label, relative to
   the baseline label (default `ubuntu-latest`, `k = 1.0`). See [Calibration](#calibration).
   `k` is null when there is no benchmark pair.
3. **`ci_job_tradeoffs`** (saved SQL view). One row for each (repo, workflow, job, label):
   `duration_p50_s`, `duration_p90_s`, `cost_per_run_usd`, `mem_fit`, `unreliable`, `source`
   (`measured` | `calibrated` | `uncalibrated` | `does_not_fit`), `is_current_label`,
   `runs_per_month`. It also gives the backtest rows (see [Backtest](#backtest)).
4. **Canvas component "Runner trade-offs".** It reads only `ci_job_tradeoffs` and
   `ci_label_profile`. It does no math other than formatting.

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

When `Nₛ = 1`, `p = 0`. The job estimate is the sum of its step estimates. The cost per run is
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

For each label `L` other than the baseline: take pairs of runs of the same job on the same commit
(`sha`) on the baseline and on `L`, from `workflow_dispatch` runs of the runner-benchmark workflow.
Keep steps with `c ≤ 1.2` on both labels and `t ≥ 20 s` on the baseline. Then:

```
k_L = median(t_baseline / t_L)
```

When a label has no such pair, `k_L` is null.

### Known bias

`c` is an average, so short bursts of parallel work look like serial work. Because of this, the
estimate gives too little gain on bigger runners for bursty steps such as `cargo build`.
Calibration does not fix this. Measured runs fix it. `docs/rightsizing.md` and the canvas header
say this.

### Backtest

For each (job, label) pair that is measured and where the label is not the job's source label,
the view also computes the estimate from the source label, as if the pair had no runs. It gives `error_pct = (estimate − measured) / measured`.
The canvas header shows the median of `|error_pct|` for calibrated and for uncalibrated estimates.

## Canvas

- **Kind:** component "Runner trade-offs" (placement config: `repo`, `workflow` optional,
  `window_days` default 14, `baseline_label` default `ubuntu-latest`), placed in a grid canvas
  "CI runners". Capabilities: `inlineQueries: true`, `state: ["user"]`, no events, no network
  origins, no actions.
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
- **Viewer state:** filters persist for each viewer (`ph.state` user scope).

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
  sql/ci_label_profile.sql
  sql/ci_label_speed.sql
  sql/ci_job_tradeoffs.sql
  canvas/runner-tradeoffs/     component source and placement contract
  install.mjs                  upserts the views and publishes the component and the grid canvas
  test/model.test.mjs          model tests through the PostHog query API
docs/events.md                 event contract
docs/rightsizing.md            model, rules, known bias, how to calibrate
src/post.ts, src/collectEvents.ts   add the `repo` property (v3.1.0)
```

- `node posthog/install.mjs --project <id>` with a personal API key (env `POSTHOG_PERSONAL_API_KEY`,
  host env `POSTHOG_HOST`, default `https://us.posthog.com`). It finds views and canvases by name
  and updates them, so a second run changes nothing. It changes no events.
- The README gets a "Rightsizing in PostHog" section that links to `docs/rightsizing.md`.
- The planning step must confirm that the canvas API is open to personal API keys. If it is not,
  `install.mjs` installs the views only, and the docs explain how to publish the canvas with the
  PostHog MCP server.

## Testing

- **Model tests.** The estimate math in `ci_job_tradeoffs` reads from one CTE `step_medians`
  (and `label_profile`, `label_speed`). `posthog/test/model.test.mjs` replaces these CTEs with
  fixed rows built with `arrayJoin`, runs the query read-only through the PostHog query API, and
  compares the results with hand-computed values. Cases:
  - a network step (`c = 0.2`): duration almost unchanged;
  - a single-threaded step (`c = 1`): changes only with `k`;
  - a parallel step (`c = Nₛ`): scales with `Nₛ/Nₜ`;
  - a memory misfit: `does_not_fit`;
  - swap used: `unreliable`;
  - a measured pair: `measured`, no estimate;
  - calibration: `k` from paired single-threaded steps.
  The test writes nothing to the project. A fork CI job runs it with a read-only personal API key
  stored as a secret; without the secret, the job is skipped.
- **Canvas.** The platform validates the project at publish time. Check by hand in PostHog Desktop.
- **Live acceptance (Ryzome):**
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
