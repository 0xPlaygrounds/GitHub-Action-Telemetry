-- One row for each job and runner label, with the duration and cost to show and their source:
--   measured      3 or more successful runs on the label
--   does_not_fit  the median peak memory on the source label is above 90% of the label's memory
--   calibrated    the source and target labels both have a speed factor
--   uncalibrated  one of them has no speed factor
-- An estimate is the time outside steps (the source label's median job duration minus the sum of
-- step medians, at least 0) plus the sum of the target label's step estimates from
-- ci_step_tradeoffs; a job with no step data has no estimate. Estimates are unreliable when the
-- source runs used swap or had more than 20% I/O wait. Measured labels other than the source
-- label, with a measured p50 above 0, also get the estimate as a backtest.
WITH labels AS (
    SELECT
        profile.runner_label AS runner_label,
        profile.mem_total_mb AS mem_total_mb,
        profile.price_per_minute_usd AS price_per_minute_usd,
        profile.queued_s_p50 AS queued_s_p50,
        nullIf(speed.k, 0) AS k
    FROM ci_label_profile AS profile
    LEFT JOIN ci_label_speed AS speed ON profile.runner_label = speed.runner_label
),
deltas AS (
    SELECT
        repo,
        job_key,
        target_label,
        sum(t_s) AS t_s,
        sum(estimate_s) AS estimate_s,
        count() AS steps
    FROM ci_step_tradeoffs AS step_tradeoffs
    GROUP BY repo, job_key, target_label
),
pairs AS (
    SELECT
        sources.repo AS repo,
        sources.workflow AS workflow,
        sources.job_key AS job_key,
        tgt_label.runner_label AS runner_label,
        sources.source_label AS source_label,
        tgt_label.runner_label = sources.current_label AS is_current_label,
        ifNull(target_stats.runs, 0) AS runs,
        target_stats.duration_p50_s AS measured_p50_s,
        target_stats.duration_p90_s AS measured_p90_s,
        if(ifNull(deltas.steps, 0) > 0, greatest(0, source_stats.duration_p50_s - deltas.t_s) + deltas.estimate_s, NULL) AS estimate_s,
        source_stats.mem_peak_mb_p50 > 0.9 * tgt_label.mem_total_mb AS too_big,
        src_label.k IS NOT NULL AND tgt_label.k IS NOT NULL AS calibrated,
        source_stats.swap_peak_mb_max > 0 OR source_stats.iowait_pct_p50 > 20 AS strained,
        tgt_label.price_per_minute_usd AS price_per_minute_usd,
        tgt_label.queued_s_p50 AS queued_s_p50,
        sources.normal_runs * 30 / {{window_days}} AS runs_per_month
    FROM ci_job_sources AS sources
    INNER JOIN ci_job_label_stats AS source_stats
        ON source_stats.repo = sources.repo
        AND source_stats.job_key = sources.job_key
        AND source_stats.runner_label = sources.source_label
    INNER JOIN labels AS src_label ON src_label.runner_label = sources.source_label
    CROSS JOIN labels AS tgt_label
    LEFT JOIN ci_job_label_stats AS target_stats
        ON target_stats.repo = sources.repo
        AND target_stats.job_key = sources.job_key
        AND target_stats.runner_label = tgt_label.runner_label
    LEFT JOIN deltas
        ON deltas.repo = sources.repo
        AND deltas.job_key = sources.job_key
        AND deltas.target_label = tgt_label.runner_label
),
ruled AS (
    SELECT
        *,
        multiIf(
            runs >= 3, 'measured',
            too_big, 'does_not_fit',
            calibrated, 'calibrated',
            'uncalibrated'
        ) AS source,
        runs >= 3 AND runner_label != source_label AND measured_p50_s > 0 AND estimate_s IS NOT NULL AS backtested
    FROM pairs
)
SELECT
    repo,
    workflow,
    job_key,
    runner_label,
    source_label,
    is_current_label,
    runs,
    source,
    multiIf(source = 'measured', measured_p50_s, source = 'does_not_fit', NULL, estimate_s) AS duration_p50_s,
    if(source = 'measured', measured_p90_s, NULL) AS duration_p90_s,
    ceil(multiIf(source = 'measured', measured_p50_s, source = 'does_not_fit', NULL, estimate_s) / 60) * price_per_minute_usd AS cost_per_run_usd,
    source IN ('calibrated', 'uncalibrated') AND strained AS unreliable,
    queued_s_p50,
    runs_per_month,
    if(backtested, estimate_s, NULL) AS backtest_estimate_s,
    if(backtested, (estimate_s - measured_p50_s) / measured_p50_s, NULL) AS backtest_error,
    if(backtested, if(calibrated, 'calibrated', 'uncalibrated'), NULL) AS backtest_kind
FROM ruled
