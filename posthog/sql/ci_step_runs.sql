-- One row for each step of each job run. A step without CPU data has cores_busy_avg 0.
SELECT
    repo,
    job_key,
    job_id,
    run_id,
    runner_label,
    sha,
    trigger,
    JSONExtractString(step, 'name') AS step_name,
    JSONExtractFloat(step, 'duration_s') AS duration_s,
    JSONExtractFloat(step, 'cores_busy_avg') AS cores_busy_avg
FROM (
    SELECT
        repo,
        job_key,
        job_id,
        run_id,
        runner_label,
        sha,
        trigger,
        arrayJoin(JSONExtractArrayRaw(ifNull(steps_json, '[]'))) AS step
    FROM ci_job_runs AS runs
)
