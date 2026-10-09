-- One row for each runner label seen in the window: machine size, the latest known price, and
-- the median queue time.
SELECT
    runner_label,
    max(vcpus) AS vcpus,
    max(mem_total_mb) AS mem_total_mb,
    argMax(cpu_model, completed_at) AS cpu_model,
    argMaxIf(price_per_minute_usd, completed_at, price_per_minute_usd IS NOT NULL) AS price_per_minute_usd,
    quantile(0.5)(queued_s) AS queued_s_p50,
    count() AS runs
FROM ci_job_runs AS runs
GROUP BY runner_label
