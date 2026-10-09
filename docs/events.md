# Event contract

The action sends these events to PostHog. Property names and meanings are a public contract: a
change to them is a breaking change and needs a new major version. New properties can come in a
minor version. All events use `distinct_id: "ci"` and `$process_person_profile: false`, and a
deterministic `uuid`, so a second send of the same job does not add a second event.

## `ci_job_resources` (main action, one per job)

| Property | Meaning |
|---|---|
| `repo` | `owner/name` (since 3.1.0) |
| `job_key` | `job_key` input, else the job id in the workflow file (since 3.1.0) |
| `workflow`, `job`, `job_id`, `run_id`, `run_attempt` | GitHub identifiers; `job` is the job name from the API |
| `runner_label`, `runner_name` | Labels joined with `,`; runner machine name |
| `cpu_cores`, `cpu_model`, `arch`, `mem_total_mb`, `disk_total_gb` | Machine facts |
| `cpu_avg_pct`, `cpu_p95_pct`, `cores_busy_avg`, `cores_busy_p95` | CPU use over the job |
| `iowait_avg_pct`, `load1_max` | I/O wait and load |
| `mem_peak_mb`, `mem_peak_pct`, `swap_peak_mb` | Memory |
| `disk_read_mb`, `disk_write_mb`, `disk_read_mbps_p95`, `disk_write_mbps_p95`, `disk_free_min_gb` | Disk |
| `net_rx_mb`, `net_tx_mb` | Network |
| `sampled_s` | Seconds of samples |
| `sccache_hits`, `sccache_misses`, `sccache_hit_rate` | When sccache ran |
| `top_processes` | When `proc_trace_enable` is `true` |
| `steps[]` | `name`, `duration_s`, `cpu_avg_pct`, `cpu_p95_pct`, `cores_busy_avg`, `mem_peak_mb`, `disk_read_mb`, `disk_write_mb`, `net_rx_mb`, `net_tx_mb` |

## `ci_job` (`collect` action, one per job of the reported run)

| Property | Meaning |
|---|---|
| `repo` | `owner/name` (since 3.1.0) |
| `workflow`, `event`, `branch`, `sha`, `pr_number`, `run_id`, `run_attempt`, `run_url` | Run context; `event` is the trigger, for example `push` or `workflow_dispatch` |
| `job`, `job_id`, `conclusion`, `job_url` | Job |
| `runner_label`, `runner_group`, `runner_name` | Runner |
| `queued_s`, `duration_s` | Seconds |
| `billable_minutes`, `price_per_minute_usd`, `cost_usd` | Whole minutes and price from `runner_prices`; `cost_usd` is null when the label has no price |
| `steps[]` | `name`, `conclusion`, `duration_s` |

## `ci_run` (`collect` action, one per reported run)

| Property | Meaning |
|---|---|
| `repo` | `owner/name` (since 3.1.0) |
| Run context | Same as `ci_job` |
| `conclusion`, `duration_s`, `jobs`, `jobs_skipped`, `runner_minutes`, `billable_minutes`, `cost_usd` | Run totals |
