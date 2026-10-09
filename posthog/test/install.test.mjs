import { describe, expect, it } from 'vitest'
import { componentProject, ensureGrid, upsertView } from '../lib/install.mjs'

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

describe('componentProject', () => {
  it('keeps the shell and pins of the canvas and adds the component files', () => {
    const project = componentProject(
      {
        project: {
          entryHtml: 'index.html',
          files: { 'index.html': '<shell>' },
          dependencies: { react: '19.1.0', three: '0.179.1' },
          canvasSdkVersion: '0.2.0'
        }
      },
      { windowDays: 14, baselineLabel: 'ubuntu-latest' }
    )
    expect(project.files['index.html']).toBe('<shell>')
    expect(project.files['src/settings.js']).toBe(
      "export const WINDOW_DAYS = 14\nexport const BASELINE_LABEL = 'ubuntu-latest'\n"
    )
    expect(Object.keys(project.files).sort()).toEqual([
      'index.html',
      'src/canvas.tsx',
      'src/settings.js',
      'src/view.js'
    ])
    expect(project.dependencies).toEqual({
      react: '19.1.0',
      'react-dom': '19.0.0',
      '@posthog/quill': '0.3.0-beta.18',
      'lucide-react': '1.21.0',
      recharts: '2.15.0'
    })
    expect(project.capabilities.posthog).toEqual({
      insights: [],
      inlineQueries: true,
      captureEvents: [],
      state: ['user'],
      actions: []
    })
    expect(project.component.configSchema.properties).toHaveProperty('repo')
  })
})

describe('ensureGrid', () => {
  it('leaves a grid that already has the placement unchanged', async () => {
    const calls = []
    const api = {
      get: async path => {
        calls.push(['GET', path])
        if (path.startsWith('/canvases/?')) {
          return { results: [{ id: 'g1', name: 'CI runners', kind: 'grid' }] }
        }
        return {
          current_version_id: 'v1',
          layout: { placements: [{ id: 'runner-tradeoffs' }] }
        }
      },
      post: async (path, body) => {
        calls.push(['POST', path, body])
        return {}
      }
    }
    expect(await ensureGrid(api, { channelId: 'c1', componentId: 'k1' })).toBe(
      'unchanged'
    )
    expect(calls.filter(call => call[0] === 'POST')).toEqual([])
  })
})
