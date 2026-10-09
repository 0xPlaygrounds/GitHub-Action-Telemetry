import { describe, expect, it } from 'vitest'
import { upsertView } from '../lib/install.mjs'

function fakeApi(existing) {
  const calls = []
  return {
    calls,
    get: async path => {
      calls.push(['GET', path])
      return { results: existing }
    },
    post: async (path, body) => {
      calls.push(['POST', path, body])
      return { id: 'new' }
    },
    patch: async (path, body) => {
      calls.push(['PATCH', path, body])
      return {}
    }
  }
}

describe('upsertView', () => {
  it('creates a view that does not exist', async () => {
    const api = fakeApi([{ id: 'x', name: 'ci_job_runs_old', query: {} }])
    expect(await upsertView(api, 'ci_job_runs', 'SELECT 1')).toBe('created')
    expect(api.calls.at(-1)).toEqual([
      'POST',
      '/warehouse_saved_queries/',
      { name: 'ci_job_runs', query: { kind: 'HogQLQuery', query: 'SELECT 1' } }
    ])
  })

  it('updates a view whose SQL changed', async () => {
    const api = fakeApi([
      { id: 'v1', name: 'ci_job_runs', query: { query: 'SELECT 0' } }
    ])
    expect(await upsertView(api, 'ci_job_runs', 'SELECT 1')).toBe('updated')
    expect(api.calls.at(-1)).toEqual([
      'PATCH',
      '/warehouse_saved_queries/v1/',
      { query: { kind: 'HogQLQuery', query: 'SELECT 1' } }
    ])
  })

  it('leaves a view with the same SQL unchanged', async () => {
    const api = fakeApi([
      { id: 'v1', name: 'ci_job_runs', query: { query: 'SELECT 1' } }
    ])
    expect(await upsertView(api, 'ci_job_runs', 'SELECT 1')).toBe('unchanged')
    expect(api.calls).toHaveLength(1)
  })
})
