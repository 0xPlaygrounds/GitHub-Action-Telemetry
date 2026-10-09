-- One row for each job. The source label (most runs; the later label name wins a tie) feeds the
-- estimates. The current label is the label of the last normal run, or '' when the job has no
-- normal run.
SELECT
    repo,
    job_key,
    argMax(runner_label, tuple(runs, runner_label)) AS source_label,
    argMaxIf(runner_label, last_normal_run_at, stats.normal_runs > 0) AS current_label,
    sum(normal_runs) AS normal_runs,
    argMax(workflow, tuple(stats.normal_runs > 0, last_normal_run_at)) AS workflow
FROM ci_job_label_stats AS stats
GROUP BY repo, job_key
