import { describe, expect, it } from 'vitest'
import { jobIdentity } from './identity.js'

describe('jobIdentity', () => {
  it('uses the job id of the workflow file when no key is set', () => {
    expect(jobIdentity('o', 'r', '', 'lint-and-test')).toEqual({
      repo: 'o/r',
      job_key: 'lint-and-test'
    })
  })

  it('uses the job_key input when it is set', () => {
    expect(jobIdentity('o', 'r', ' warm-clippy ', 'warm')).toEqual({
      repo: 'o/r',
      job_key: 'warm-clippy'
    })
  })
})
