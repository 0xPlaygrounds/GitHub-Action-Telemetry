-- One row for each successful job run that sent ci_job_resources, joined on job_id to its ci_job
-- event from the collect action. Duplicate events of a job collapse to one row. A job whose
-- workflow the collect action does not report has no ci_job event and is not in this view.
SELECT
    r.repo AS repo,
    r.job_key AS job_key,
    j.workflow AS workflow,
    r.job AS job,
    r.job_id AS job_id,
    j.run_id AS run_id,
    j.runner_label AS runner_label,
    r.vcpus AS vcpus,
    r.mem_total_mb AS mem_total_mb,
    r.cpu_model AS cpu_model,
    r.mem_peak_mb AS mem_peak_mb,
    r.swap_peak_mb AS swap_peak_mb,
    r.iowait_avg_pct AS iowait_avg_pct,
    r.steps_json AS steps_json,
    j.duration_s AS duration_s,
    j.queued_s AS queued_s,
    j.price_per_minute_usd AS price_per_minute_usd,
    j.sha AS sha,
    j.trigger AS trigger,
    j.completed_at AS completed_at
FROM (
    SELECT
        toString(properties.job_id) AS job_id,
        any(coalesce(properties.repo, '')) AS repo,
        any(coalesce(properties.job_key, properties.job)) AS job_key,
        any(properties.job) AS job,
        any(toInt(properties.cpu_cores)) AS vcpus,
        any(toFloat(properties.mem_total_mb)) AS mem_total_mb,
        any(properties.cpu_model) AS cpu_model,
        any(toFloat(properties.mem_peak_mb)) AS mem_peak_mb,
        any(ifNull(toFloat(properties.swap_peak_mb), 0)) AS swap_peak_mb,
        any(ifNull(toFloat(properties.iowait_avg_pct), 0)) AS iowait_avg_pct,
        any(toString(properties.steps)) AS steps_json
    FROM events
    WHERE event = 'ci_job_resources'
        AND timestamp > now() - INTERVAL {{window_days}} DAY
        AND properties.job_id IS NOT NULL
    GROUP BY job_id
) AS r
INNER JOIN (
    SELECT
        toString(properties.job_id) AS job_id,
        any(properties.workflow) AS workflow,
        any(toString(properties.run_id)) AS run_id,
        any(properties.runner_label) AS runner_label,
        any(toFloat(properties.duration_s)) AS duration_s,
        any(toFloat(properties.queued_s)) AS queued_s,
        any(toFloatOrNull(toString(properties.price_per_minute_usd))) AS price_per_minute_usd,
        any(properties.sha) AS sha,
        any(properties.event) AS trigger,
        max(timestamp) AS completed_at
    FROM events
    WHERE event = 'ci_job'
        AND timestamp > now() - INTERVAL {{window_days}} DAY
        AND properties.conclusion = 'success'
    GROUP BY job_id
) AS j ON r.job_id = j.job_id
