// The job_key stays the same when a job runs on another runner label or is called from another
// workflow, so runs of one job can be compared. It defaults to the workflow file name (the
// caller's file for a reusable workflow) and the job id, for example `ci-rust.yaml/test`. The
// workflow file name comes from GITHUB_WORKFLOW_REF: everything before the first `@` is dropped,
// then only the text after the last `/` is kept. If that env var is missing or empty, the job id
// is used alone.
export function jobIdentity(
  owner: string,
  repo: string,
  jobKeyInput: string,
  contextJob: string,
  workflowRef: string
): { repo: string; job_key: string } {
  const workflowFile = workflowRef.split('@')[0].split('/').pop() || ''
  const defaultJobKey = workflowFile
    ? `${workflowFile}/${contextJob}`
    : contextJob
  return {
    repo: `${owner}/${repo}`,
    job_key: jobKeyInput.trim() || defaultJobKey
  }
}
