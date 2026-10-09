-- Estimated duration of each step of a job on each runner label, from the step's median duration
-- t and median busy cores c on the job's source label:
--   w  = max(0, 1 - c)                    share of time with no CPU work
--   p  = clamp((c - 1) / (Ns - 1), 0, 1)  parallel share
--   t' = t * (w + (1 - w) * ((1 - p) + p * Ns / Nt) * ks / kt)
-- Ns and Nt are the vCPUs of the source and target labels, ks and kt their speed factors. A label
-- without a speed factor uses k = 1.
WITH steps AS (
    SELECT
        repo,
        job_key,
        runner_label,
        step_name,
        quantile(0.5)(duration_s) AS t_s,
        quantile(0.5)(cores_busy_avg) AS c
    FROM ci_step_runs AS step_runs
    GROUP BY repo, job_key, runner_label, step_name
),
labels AS (
    SELECT
        profile.runner_label AS runner_label,
        profile.vcpus AS vcpus,
        nullIf(speed.k, 0) AS k
    FROM ci_label_profile AS profile
    LEFT JOIN ci_label_speed AS speed ON profile.runner_label = speed.runner_label
),
factors AS (
    SELECT
        steps.repo AS repo,
        steps.job_key AS job_key,
        steps.step_name AS step_name,
        sources.source_label AS source_label,
        tgt_label.runner_label AS target_label,
        steps.t_s AS t_s,
        steps.c AS c,
        greatest(0, 1 - steps.c) AS w,
        if(src_label.vcpus > 1, least(1, greatest(0, (steps.c - 1) / (src_label.vcpus - 1))), 0) AS p,
        src_label.vcpus AS source_vcpus,
        tgt_label.vcpus AS target_vcpus,
        ifNull(src_label.k, 1.0) AS source_k,
        ifNull(tgt_label.k, 1.0) AS target_k
    FROM steps
    INNER JOIN ci_job_sources AS sources
        ON steps.repo = sources.repo
        AND steps.job_key = sources.job_key
        AND steps.runner_label = sources.source_label
    INNER JOIN labels AS src_label ON src_label.runner_label = sources.source_label
    CROSS JOIN labels AS tgt_label
)
SELECT
    repo,
    job_key,
    step_name,
    source_label,
    target_label,
    factors.t_s AS t_s,
    factors.c AS c,
    factors.w AS w,
    factors.p AS p,
    factors.t_s * (factors.w + (1 - factors.w) * ((1 - factors.p) + factors.p * source_vcpus / target_vcpus) * source_k / target_k) AS estimate_s
FROM factors
