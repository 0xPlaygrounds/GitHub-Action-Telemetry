-- One row for each job and runner label. Normal runs are runs not started by hand
-- (workflow_dispatch), such as push and pull_request runs. The workflow name comes from the
-- latest normal run, else from the latest run. last_run_at is the time of the last run.
SELECT
    repo,
    job_key,
    runner_label,
    argMax(workflow, tuple(trigger != 'workflow_dispatch', completed_at)) AS workflow,
    count() AS runs,
    quantile(0.5)(duration_s) AS duration_p50_s,
    quantile(0.9)(duration_s) AS duration_p90_s,
    quantile(0.5)(mem_peak_mb) AS mem_peak_mb_p50,
    max(swap_peak_mb) AS swap_peak_mb_max,
    quantile(0.5)(iowait_avg_pct) AS iowait_pct_p50,
    countIf(trigger != 'workflow_dispatch') AS normal_runs,
    maxIf(completed_at, trigger != 'workflow_dispatch') AS last_normal_run_at,
    max(completed_at) AS last_run_at
FROM ci_job_runs AS runs
GROUP BY repo, job_key, runner_label
