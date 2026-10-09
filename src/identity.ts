// The job_key stays the same when a job runs on another runner label or is called from another
// workflow, so runs of one job can be compared. It defaults to the job's id in its workflow file.
export function jobIdentity(
  owner: string,
  repo: string,
  jobKeyInput: string,
  contextJob: string
): { repo: string; job_key: string } {
  return {
    repo: `${owner}/${repo}`,
    job_key: jobKeyInput.trim() || contextJob
  }
}
