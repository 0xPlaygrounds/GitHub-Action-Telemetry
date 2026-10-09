import { describe, expect, it } from 'vitest'
import {
  componentProject,
  containsJson,
  ensureGrid,
  upsertComponent,
  upsertView
} from '../lib/install.mjs'

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
      actions: [],
      agentRequests: false
    })
    expect(project.component.configSchema.properties).toHaveProperty('repo')
  })
})

describe('containsJson', () => {
  it('ignores an extra key the stored side adds in a nested object', () => {
    expect(containsJson({ a: { b: 1, c: 2 } }, { a: { b: 1 } })).toBe(true)
  })

  it('is false when a sent value differs from the stored value', () => {
    expect(containsJson({ a: 1 }, { a: 2 })).toBe(false)
  })

  it('is false when an array differs between stored and sent', () => {
    expect(containsJson({ a: [1, 2] }, { a: [1, 2, 3] })).toBe(false)
  })
})

describe('upsertComponent', () => {
  const settings = { windowDays: 14, baselineLabel: 'ubuntu-latest' }

  it('does not publish when the current source already matches the built project', async () => {
    const project = componentProject(null, settings)
    const calls = []
    const api = {
      get: async path => {
        calls.push(['GET', path])
        if (path.startsWith('/canvases/?')) {
          return {
            results: [
              {
                id: 'c1',
                name: 'Runner trade-offs',
                kind: 'component',
                url: 'https://x/c1'
              }
            ]
          }
        }
        return { current_version_id: 'v1', project }
      },
      post: async (path, body) => {
        calls.push(['POST', path, body])
        return { id: 'new' }
      }
    }
    expect(await upsertComponent(api, { channelId: 'c1', settings })).toBe('c1')
    expect(calls.filter(call => call[0] === 'POST')).toEqual([])
  })

  it('publishes once when the source has a different canvas.tsx', async () => {
    const project = componentProject(null, settings)
    const staleProject = {
      ...project,
      files: { ...project.files, 'src/canvas.tsx': 'stale' }
    }
    const calls = []
    const api = {
      get: async path => {
        calls.push(['GET', path])
        if (path.startsWith('/canvases/?')) {
          return {
            results: [
              {
                id: 'c1',
                name: 'Runner trade-offs',
                kind: 'component',
                url: 'https://x/c1'
              }
            ]
          }
        }
        return { current_version_id: 'v1', project: staleProject }
      },
      post: async (path, body) => {
        calls.push(['POST', path, body])
        return { id: 'new' }
      }
    }
    expect(await upsertComponent(api, { channelId: 'c1', settings })).toBe('c1')
    const publishCalls = calls.filter(
      call => call[0] === 'POST' && call[1] === '/canvases/c1/publish/'
    )
    expect(publishCalls).toHaveLength(1)
  })

  it('does not publish when the stored source has extra server-default fields', async () => {
    const project = componentProject(null, settings)
    const storedProject = {
      ...project,
      capabilities: {
        ...project.capabilities,
        posthog: { ...project.capabilities.posthog, someNewDefault: true }
      },
      component: {
        ...project.component,
        size: { ...project.component.size, maxW: 12 }
      }
    }
    const calls = []
    const api = {
      get: async path => {
        calls.push(['GET', path])
        if (path.startsWith('/canvases/?')) {
          return {
            results: [
              {
                id: 'c1',
                name: 'Runner trade-offs',
                kind: 'component',
                url: 'https://x/c1'
              }
            ]
          }
        }
        return { current_version_id: 'v1', project: storedProject }
      },
      post: async (path, body) => {
        calls.push(['POST', path, body])
        return { id: 'new' }
      }
    }
    expect(await upsertComponent(api, { channelId: 'c1', settings })).toBe('c1')
    expect(calls.filter(call => call[0] === 'POST')).toEqual([])
  })

  it('publishes when the stored source has a file we no longer send', async () => {
    const project = componentProject(null, settings)
    const storedProject = {
      ...project,
      files: { ...project.files, 'src/extra.js': 'leftover' }
    }
    const calls = []
    const api = {
      get: async path => {
        calls.push(['GET', path])
        if (path.startsWith('/canvases/?')) {
          return {
            results: [
              {
                id: 'c1',
                name: 'Runner trade-offs',
                kind: 'component',
                url: 'https://x/c1'
              }
            ]
          }
        }
        return { current_version_id: 'v1', project: storedProject }
      },
      post: async (path, body) => {
        calls.push(['POST', path, body])
        return { id: 'new' }
      }
    }
    expect(await upsertComponent(api, { channelId: 'c1', settings })).toBe('c1')
    const publishCalls = calls.filter(
      call => call[0] === 'POST' && call[1] === '/canvases/c1/publish/'
    )
    expect(publishCalls).toHaveLength(1)
  })

  it('creates the canvas and publishes when it does not exist yet', async () => {
    const calls = []
    const api = {
      get: async path => {
        calls.push(['GET', path])
        if (path.startsWith('/canvases/?')) return { results: [] }
        return null
      },
      post: async (path, body) => {
        calls.push(['POST', path, body])
        if (path === '/canvases/') return { id: 'new' }
        return {}
      }
    }
    expect(await upsertComponent(api, { channelId: 'c1', settings })).toBe(
      'new'
    )
    expect(calls).toEqual([
      ['GET', '/canvases/?channel=c1&kind=component&limit=100'],
      [
        'POST',
        '/canvases/',
        {
          name: 'Runner trade-offs',
          channel_id: 'c1',
          kind: 'component',
          description:
            'CI job duration and cost on each runner label, measured or estimated from CPU use. ' +
            'Config: repo and workflow filters.'
        }
      ],
      ['GET', '/canvases/new/source/'],
      [
        'POST',
        '/canvases/new/publish/',
        {
          project: componentProject(null, settings),
          prompt: 'Install Runner trade-offs from GitHub-Action-Telemetry',
          expected_current_version_id: null
        }
      ]
    ])
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
