-- Per-core speed factor k of each runner label against the baseline label {{baseline_label}}
-- (k = 1). k is the median of baseline duration / label duration over single-threaded steps
-- (at most 1.2 busy cores on both labels, at least 20 s on the baseline) that ran on both labels
-- in the same run, as in a runner benchmark. A label without such steps has no row.
-- Re-run attempts of a job in one run count as one pair.
WITH steps AS (
    SELECT
        repo,
        run_id,
        job_key,
        step_name,
        runner_label,
        quantile(0.5)(duration_s) AS duration_s,
        max(cores_busy_avg) AS cores_busy_avg
    FROM ci_step_runs AS runs
    GROUP BY repo, run_id, job_key, step_name, runner_label
)
SELECT
    l.runner_label AS runner_label,
    quantile(0.5)(b.duration_s / l.duration_s) AS k,
    count() AS pairs
FROM steps AS b
INNER JOIN steps AS l
    ON b.repo = l.repo
    AND b.run_id = l.run_id
    AND b.job_key = l.job_key
    AND b.step_name = l.step_name
WHERE b.runner_label = '{{baseline_label}}'
    AND l.runner_label != '{{baseline_label}}'
    AND b.cores_busy_avg <= 1.2
    AND l.cores_busy_avg <= 1.2
    AND b.duration_s >= 20
    AND l.duration_s > 0
GROUP BY l.runner_label
UNION ALL
SELECT
    '{{baseline_label}}' AS runner_label,
    1.0 AS k,
    0 AS pairs
