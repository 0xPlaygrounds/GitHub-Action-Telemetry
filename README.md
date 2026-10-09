# workflow-telemetry-action

A GitHub Action that collects telemetry from a workflow job: step timings, CPU, memory, disk,
and network use, and optionally every process the job runs. It writes the report to the job
summary as Mermaid charts and can send one event per job to [PostHog](https://posthog.com) so you
can compare jobs and runners over time. A second action, [`collect`](#collect-run-and-job-timings-and-cost),
sends timings and cost of whole workflow runs.

This is a maintained fork of
[catchpoint/workflow-telemetry-action](https://github.com/catchpoint/workflow-telemetry-action)
by Serkan Özal and contributors. The process tracer is built from
[borissmidt/proc-tracer](https://github.com/borissmidt/proc-tracer). See [CHANGELOG.md](CHANGELOG.md)
for the changes from upstream.

## What it reports

- **Step trace**: a Gantt chart of the job's steps, and a table of each step's duration, busy
  cores, CPU p95, peak memory, disk read/write, and network in/out.
- **Resource use**: charts of CPU (busy, I/O wait), memory (used, swap), disk I/O, network I/O,
  and workspace disk use, sampled every `metric_frequency` seconds from `/proc`.
- **Process trace** (opt-in): a Gantt chart of the longest processes, and optionally a table of all
  processes with their arguments. It uses an eBPF program, so it needs passwordless `sudo` and a
  kernel with BTF type information (Ubuntu 20.04 and later), on x64 or arm64.
- **PostHog event** (when `posthog_api_key` is set): one `ci_job_resources` event per job with
  machine facts (cores, CPU model, RAM, disk), job totals and peaks, per-step figures, the
  sccache hit rate when the job used sccache, and the 10 longest processes when tracing ran.

Disk and network figures are for the whole machine, so they include background work of the runner, for example a fresh disk being initialized at the start of a job. Each sample interval counts toward the step that was running at its middle, so steps shorter than `metric_frequency` get approximate figures.

The sampler is a bash loop that uses about 3 MB of memory. Nothing in the action fails the job:
a problem is reported as a warning.

## Usage

```yaml
permissions:
  actions: read # the post step reads the job's own steps

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Collect workflow telemetry
        uses: 0xPlaygrounds/GitHub-Action-Telemetry@v3
        with:
          posthog_api_key: ${{ secrets.POSTHOG_PROJECT_KEY }} # optional

      - uses: actions/checkout@v5
      # ... the job's other steps
```

Put the action first, so it measures all later steps. Its post step runs at the end of the job,
also when the job fails or is cancelled.

### Inputs

| Input                        | Default                    | Description                                                              |
| ---------------------------- | -------------------------- | ------------------------------------------------------------------------ |
| `github_token`               | `${{ github.token }}`      | Token used to read the job's steps (`actions: read`).                    |
| `metric_frequency`           | `5`                        | Seconds between two resource samples.                                    |
| `posthog_api_key`            |                            | PostHog project API key. Without it, the event is printed in the log.    |
| `posthog_host`               | `https://us.i.posthog.com` | PostHog ingestion host.                                                  |
| `proc_trace_enable`          | `false`                    | Trace every process with eBPF.                                           |
| `proc_trace_min_duration`    | `-1`                       | Minimum process duration in milliseconds; `-1` traces all.               |
| `proc_trace_sys_enable`      | `false`                    | Also trace common system processes (`cat`, `sed`, ...).                  |
| `proc_trace_chart_show`      | `true`                     | Show the process chart.                                                  |
| `proc_trace_chart_max_count` | `100`                      | Maximum number of processes in the chart.                                |
| `proc_trace_table_show`      | `false`                    | Show all processes with their arguments.                                 |
| `comment_on_pr`              | `false`                    | Also post the report as a pull request comment (`pull-requests: write`). |
| `job_summary`                | `true`                     | Write the report to the job summary.                                     |
| `job_key`                    |                            | Key that identifies this job across runner labels and calling workflows. Defaults to `<workflow file>/<job id>`, for example `ci-rust.yaml/test`; for a job in a reusable workflow, the workflow file is the caller's file. Set it for a matrix that runs different work under one job id. |

## Collect run and job timings and cost

The `collect` action reads one finished workflow run from the GitHub API and sends one `ci_job`
event per job (queue time, duration, runner, steps, billable minutes, cost) and one `ci_run` event
for the run. A `workflow_run` trigger must live in the repository it watches, so add a small
workflow there:

```yaml
name: CI telemetry
on:
  workflow_run:
    workflows: [CI]
    types: [completed]

permissions:
  actions: read

jobs:
  report:
    runs-on: ubuntu-latest
    steps:
      - uses: 0xPlaygrounds/GitHub-Action-Telemetry/collect@v3
        with:
          run_id: ${{ github.event.workflow_run.id }}
          posthog_api_key: ${{ secrets.POSTHOG_PROJECT_KEY }}
          runner_prices: '{"ubuntu-latest": 0.006, "my-8-core-runner": 0.022}'
```

`runner_prices` maps runner labels to USD per minute. GitHub bills each job in whole minutes, so
the cost is billable minutes × price. Without it, the GitHub standard x64 Linux prices are used.

## Rightsizing in PostHog

Saved SQL views and a PostHog Desktop canvas show, for each job, the duration and the cost on
each runner label, measured or estimated from CPU use. See [docs/rightsizing.md](docs/rightsizing.md).

## Privacy

The action sends data only to the GitHub API and, when `posthog_api_key` is set, to PostHog. The
PostHog event never contains process arguments, because they can contain secrets. The process
table in the job summary does show arguments; it is off by default.

## Development

```bash
npm ci
npm run all   # format check, lint, type check, tests, and bundles in dist/ and collect/dist/
```

The bundles are committed, so run `npm run all` before you commit. The `proc-tracer` workflow
builds `dist/proc-tracer/proc-tracer-{x64,arm64}` from `proc-tracer/` and attests them; check a
binary with `gh attestation verify dist/proc-tracer/proc-tracer-x64 -R 0xPlaygrounds/GitHub-Action-Telemetry`.

## License

[Apache License 2.0](LICENSE.md). See [NOTICE](NOTICE).
