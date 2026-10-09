# Runner rightsizing in PostHog

Shows, for each CI job, the duration and the cost on each runner label. It does not choose a
label: you read the trade-offs and decide.

## What you need

- This action in the jobs you want to compare, with `posthog_api_key` set.
- The `collect` action for the same workflows (it gives the duration, the price and the
  conclusion). A job whose workflow `collect` does not report is not shown.
- `runner_prices` in `collect` for every label you use. A label without a price shows "no price".
- To measure jobs on more labels: a workflow that runs the same jobs on several labels in one run
  (a runner benchmark). These runs also calibrate the per-core speed of each label.
- A matrix that runs different work under one job id needs `job_key`, for example
  `job_key: warm-${{ matrix.kind }}`.
- `job_key` defaults to `<workflow file>/<job id>`. For a job in a reusable workflow, the
  workflow file is the caller's file, not the reusable workflow's file. To compare runs of one
  job across workflows (for example a runner benchmark that calls a reusable CI workflow, and the
  direct CI runs), set the same `job_key` in the job, for example
  `job_key: ci-typescript/lint-and-test`.

## Install

```bash
POSTHOG_PERSONAL_API_KEY=phx_... [POSTHOG_HOST=https://eu.posthog.com] node posthog/install.ts \
  --project <project id> --channel <channel id> [--window-days 14] [--baseline ubuntu-latest]
```

The key needs `warehouse_view:read`, `warehouse_view:write`, `canvas:read` and `canvas:write`.
Without `--channel`, the script installs the views only. A second run changes nothing unless the
SQL or the canvas source changed. `--window-days` and `--baseline` are install options: changing
either one needs a new install run. `POSTHOG_HOST` is optional; the default is
`https://us.posthog.com`.

## Upgrade from 3.0

Events recorded before 3.1.0 have no `repo` and use the job name as `job_key`. For one window
after you upgrade, a job can show twice: once with an empty `repo` and once with `owner/name`.
Set the canvas placement's `repo` filter to hide the old rows.

Benchmark runs recorded before 3.1.0 cannot pair across labels. Run the runner-benchmark
workflow again after you upgrade, so the view has pairs to calibrate from.

## How to read it

Each cell is one job on one label:

| Style | Meaning |
|---|---|
| solid | measured: 3 or more successful runs on the label in the window (p50) |
| coloured border | estimate, calibrated: both labels have a speed factor from benchmark runs |
| dashed | estimate, not calibrated: a label without a speed factor uses k = 1 |
| grey | does not fit: the job's median peak memory is above 90% of the label's memory |
| ⚠ | unreliable: the job used swap or had more than 20% I/O wait |

A job's workflow name is the name of its latest normal run (a push or pull_request run, not one
started by hand), or of its latest run when it has no normal run yet.

The header shows the median estimate error of each kind, from jobs measured on more than one
label (the backtest). The calibrated error uses the per-core speed factors from the same
benchmark runs, so it shows how well the formula transfers, not a fully independent test.

## Model

For each step of a job on its source label (the label with the most runs), with the median
duration `t` and median busy cores `c`:

```
w  = max(0, 1 − c)                     share of time with no CPU work
p  = clamp((c − 1) / (Nₛ − 1), 0, 1)   parallel share
t' = t × [ w + (1 − w) × ((1 − p) + p × Nₛ/Nₜ) × kₛ/kₜ ]
```

`N` is the vCPU count and `k` the per-core speed factor of a label (1 for the baseline label and
for labels without benchmark pairs). The job estimate is the time outside steps (the source
label's median job duration minus the sum of the step medians `t`, at least 0) plus the sum of
the step estimates `t'`. The cost is the estimate in whole minutes times the label's price. Queue
time is measured only.

`k` of a label is the median of baseline time / label time over single-threaded steps (at most
1.2 busy cores, at least 20 s on the baseline) that ran on both labels in the same run. Re-run
attempts of a job in one run count as one pair: steps are collapsed per run, job, step and label
before pairing.

## Known bias

`c` is an average over the step, so short bursts of parallel work look serial. Bursty steps such
as compiles gain more on bigger runners than the estimate says. Calibration does not fix this;
measured runs do.

## Views

`ci_job_runs`, `ci_step_runs`, `ci_label_profile`, `ci_label_speed`, `ci_job_label_stats`,
`ci_job_sources`, `ci_step_tradeoffs`, `ci_job_tradeoffs`. You can use them in insights and SQL.
The SQL is in `posthog/sql/`.

## Checks

`npm run test:posthog` runs each view's SQL against fixed rows through the PostHog query API. It
reads no events except one `LIMIT 0` compile check, and writes nothing. Set
`POSTHOG_PERSONAL_API_KEY` (scope `query:read`), `POSTHOG_PROJECT_ID`, and optionally
`POSTHOG_HOST` to run it. Without them, every check skips.
