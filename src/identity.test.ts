import { describe, expect, it } from 'vitest'
import { jobIdentity } from './identity.js'

describe('jobIdentity', () => {
  it('prefixes the job id with the workflow file name when the ref is set', () => {
    expect(
      jobIdentity(
        'o',
        'r',
        '',
        'test',
        'owner/repo/.github/workflows/ci-rust.yaml@refs/heads/main'
      )
    ).toEqual({
      repo: 'o/r',
      job_key: 'ci-rust.yaml/test'
    })
  })

  it('uses only the file name from a nested workflow path', () => {
    expect(
      jobIdentity(
        'o',
        'r',
        '',
        'test',
        'owner/repo/.github/workflows/sub/ci-rust.yaml@refs/pull/1/merge'
      )
    ).toEqual({
      repo: 'o/r',
      job_key: 'ci-rust.yaml/test'
    })
  })

  it('uses the job id alone when the workflow ref is empty', () => {
    expect(jobIdentity('o', 'r', '', 'test', '')).toEqual({
      repo: 'o/r',
      job_key: 'test'
    })
  })

  it('uses the job_key input when it is set, even with a workflow ref', () => {
    expect(
      jobIdentity(
        'o',
        'r',
        ' warm-clippy ',
        'warm',
        'owner/repo/.github/workflows/ci-rust.yaml@refs/heads/main'
      )
    ).toEqual({
      repo: 'o/r',
      job_key: 'warm-clippy'
    })
  })
})
