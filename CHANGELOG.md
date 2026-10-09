# Changelog

## 3.1.0

### Added

- `repo` property (`owner/name`) on `ci_job_resources`, `ci_job` and `ci_run`.
- `job_key` input and property on `ci_job_resources`. It defaults to the job id in the workflow
  file, so runs of one job on different runner labels or from different calling workflows can be
  compared.
- `docs/events.md`: the event contract.
- `posthog/`: saved SQL views and the "Runner trade-offs" canvas for runner rightsizing, with an
  install script (`node posthog/install.mjs`). See `docs/rightsizing.md`.

## 3.0.0

Changes from catchpoint/workflow-telemetry-action v2.0.0. All files under `src/`, `action.yml`,
`package.json`, the workflows, and the README were changed.

### Breaking

- Runs on Node 24 (`node24`). GitHub removed Node 20 from its runners on 2026-09-23.
- Charts are Mermaid charts in the job summary. The external chart service (`api.globadge.com`)
  is not used any more; it began to require a token in December 2025. The `theme` input is
  removed, because Mermaid follows GitHub's theme.
- `comment_on_pr` defaults to `false`.
- Process tracing is opt-in (`proc_trace_enable: true`).

### Added

- PostHog export: `posthog_api_key` and `posthog_host` send one `ci_job_resources` event per job.
- Per-step resource table: duration, busy cores, CPU p95, peak memory, disk and network I/O.
- Machine facts, swap, I/O wait, disk free, and the sccache hit rate.
- `collect` sub-action: `ci_job` and `ci_run` events with queue time, billable minutes, and cost
  by runner label (`runner_prices`).
- Process tracer built from source (borissmidt/proc-tracer, CO-RE eBPF) for x64 and arm64, on
  any kernel with BTF, including Ubuntu 24.04. Binaries are built and attested in CI.

### Changed

- The sampler is a bash loop that reads `/proc` (about 3 MB of memory), in place of a Node
  worker with a local HTTP server and the `systeminformation` package.
- Dependencies: only `@actions/core` and `@actions/github` remain at run time; `axios`,
  `systeminformation`, `sprintf-js`, and `@octokit/action` are removed. No known vulnerabilities.
- The post step runs with `post-if: always()` and reports problems as warnings, never as errors.
- ESM, TypeScript 6, ESLint flat config, and Vitest tests.

### Fixed

- Process durations from the proc-tracer were divided by 10⁷ in place of 10⁶.
- Process start times are converted from the kernel's monotonic clock to wall-clock time, so the
  process chart lines up with the step chart.
- Steps that the API lists without an end time are still reported.
- Job lookup pages start at 1 (the API ignores page 0 and returned page 1 twice).
