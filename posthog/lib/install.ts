import { readFileSync } from 'node:fs'
import { readView, VIEWS, type RenderOptions } from './sql.ts'
import type { Api } from './api.ts'

const COMPONENT_NAME = 'Runner trade-offs'
const GRID_NAME = 'CI runners'
const PLACEMENT_ID = 'runner-tradeoffs'
const COMPONENT_DEPENDENCIES = [
  'react',
  'react-dom',
  '@posthog/quill',
  'lucide-react',
  'recharts'
]

export interface ComponentProject {
  schemaVersion: 1
  entryHtml: string
  files: Record<string, string>
  dependencies: Record<string, string>
  canvasSdkVersion: string
  capabilities: {
    posthog: {
      insights: unknown[]
      inlineQueries: boolean
      captureEvents: unknown[]
      state: string[]
      actions: unknown[]
      agentRequests: boolean
    }
    network: { origins: unknown[] }
  }
  component: {
    size: { defaultW: number; defaultH: number; minW: number; minH: number }
    configSchema: {
      type: string
      properties: Record<string, { type: string; description: string }>
    }
  }
}

// The shape of a project as it comes back from the API: it may be an older or partial version of
// what componentProject() builds, so only the fields we read are typed; everything else is unknown.
export interface StoredProject {
  entryHtml?: string
  files?: Record<string, string>
  dependencies?: Record<string, string>
  canvasSdkVersion?: string
  capabilities?: unknown
  component?: unknown
  [key: string]: unknown
}

const FALLBACK_PROJECT: Required<
  Pick<
    StoredProject,
    'entryHtml' | 'files' | 'dependencies' | 'canvasSdkVersion'
  >
> = {
  entryHtml: 'index.html',
  files: {
    'index.html':
      '<!doctype html>\n<html>\n  <head>\n    <meta charset="utf-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1" />\n  </head>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="/src/canvas.tsx"></script>\n  </body>\n</html>\n'
  },
  dependencies: {
    react: '19.0.0',
    'react-dom': '19.0.0',
    '@posthog/quill': '0.3.0-beta.18',
    'lucide-react': '1.21.0',
    recharts: '2.15.0'
  },
  canvasSdkVersion: '0.2.0'
}

const canvasFile = (path: string): string =>
  readFileSync(
    new URL(`../canvas/runner-tradeoffs/${path}`, import.meta.url),
    'utf8'
  )

export interface CanvasSource {
  project?: StoredProject | null
  current_version_id?: string | null
}

// The shell and the dependency pins come from the canvas's current source, so they match the
// platform's supported versions; a canvas with no source yet uses the fallback.
export function componentProject(
  source: CanvasSource | null | undefined,
  { windowDays, baselineLabel }: RenderOptions
): ComponentProject {
  const projectSource = source?.project
  const hasIndexHtml = Boolean(projectSource?.files?.['index.html'])
  const base = hasIndexHtml && projectSource ? projectSource : FALLBACK_PROJECT
  const files = base.files ?? FALLBACK_PROJECT.files
  const dependencies = Object.fromEntries(
    Object.entries({
      ...FALLBACK_PROJECT.dependencies,
      ...(base.dependencies ?? {})
    }).filter(([name]) => COMPONENT_DEPENDENCIES.includes(name))
  )
  return {
    schemaVersion: 1,
    entryHtml: base.entryHtml ?? 'index.html',
    files: {
      'index.html': files['index.html'] ?? '',
      'src/canvas.tsx': canvasFile('src/canvas.tsx'),
      'src/view.js': canvasFile('src/view.js'),
      'src/settings.js': `export const WINDOW_DAYS = ${windowDays}\nexport const BASELINE_LABEL = ${JSON.stringify(baselineLabel)}\n`
    },
    dependencies,
    canvasSdkVersion:
      base.canvasSdkVersion ?? FALLBACK_PROJECT.canvasSdkVersion,
    capabilities: {
      posthog: {
        insights: [],
        inlineQueries: true,
        captureEvents: [],
        state: ['user'],
        actions: [],
        agentRequests: false
      },
      network: { origins: [] }
    },
    component: {
      size: { defaultW: 12, defaultH: 24, minW: 6, minH: 10 },
      configSchema: {
        type: 'object',
        properties: {
          repo: {
            type: 'string',
            description: 'Repository (owner/name) to show; all when empty'
          },
          workflow: {
            type: 'string',
            description: 'Workflow to show; when empty, each viewer picks one'
          }
        }
      }
    }
  }
}

// The default sort order: matches Array#sort() with no compare function (string, code unit order).
const ordinal = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

// Deep-equality check that ignores key order, so a rebuilt project that differs only in property
// insertion order still counts as unchanged.
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (
    typeof a !== 'object' ||
    a === null ||
    typeof b !== 'object' ||
    b === null
  ) {
    return false
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    return (
      a.length === b.length &&
      a.every((value, index) => sameJson(value, b[index]))
    )
  }
  const aRecord = a as Record<string, unknown>
  const bRecord = b as Record<string, unknown>
  const aKeys = Object.keys(aRecord).sort(ordinal)
  const bKeys = Object.keys(bRecord).sort(ordinal)
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every(
    (key, index) => key === bKeys[index] && sameJson(aRecord[key], bRecord[key])
  )
}

// True when every key we sent is present in the stored value with an equal value: nested objects
// recurse the same way, arrays must match exactly, and extra keys the server adds are ignored.
export function containsJson(stored: unknown, sent: unknown): boolean {
  if (sent === stored) return true
  if (
    typeof sent !== 'object' ||
    sent === null ||
    typeof stored !== 'object' ||
    stored === null
  ) {
    return false
  }
  if (Array.isArray(sent) || Array.isArray(stored))
    return sameJson(stored, sent)
  const sentRecord = sent as Record<string, unknown>
  const storedRecord = stored as Record<string, unknown>
  return Object.keys(sentRecord).every(key =>
    containsJson(storedRecord[key], sentRecord[key])
  )
}

export interface CanvasListItem {
  id: string
  name: string
  kind?: string
  url?: string
}

interface CanvasListResponse {
  results?: CanvasListItem[]
}

async function findCanvas(
  api: Api,
  channelId: string,
  kind: string,
  name: string
): Promise<CanvasListItem | null> {
  const list = (await api.get(
    `/canvases/?channel=${encodeURIComponent(channelId)}&kind=${kind}&limit=100`
  )) as CanvasListResponse
  return (list.results ?? []).find(canvas => canvas.name === name) ?? null
}

export type Logger = (message: string) => void

export interface UpsertComponentOptions {
  channelId: string
  settings: RenderOptions
}

export interface PublishResult {
  build?: { status?: string; [key: string]: unknown }
}

export async function upsertComponent(
  api: Api,
  { channelId, settings }: UpsertComponentOptions,
  log: Logger = console.log
): Promise<string> {
  const canvas =
    (await findCanvas(api, channelId, 'component', COMPONENT_NAME)) ??
    ((await api.post('/canvases/', {
      name: COMPONENT_NAME,
      channel_id: channelId,
      kind: 'component',
      description:
        'CI job duration and cost on each runner label, measured or estimated from CPU use. ' +
        'Config: repo and workflow filters.'
    })) as CanvasListItem)
  const source = (await api.get(
    `/canvases/${canvas.id}/source/`
  )) as CanvasSource | null
  const project = componentProject(source, settings)
  const exactKeys: Array<keyof ComponentProject> = [
    'files',
    'dependencies',
    'canvasSdkVersion'
  ]
  const containedKeys: Array<keyof ComponentProject> = [
    'capabilities',
    'component'
  ]
  const unchanged =
    Boolean(source?.project) &&
    exactKeys.every(key => sameJson(project[key], source?.project?.[key])) &&
    containedKeys.every(key =>
      containsJson(source?.project?.[key], project[key])
    )
  if (unchanged) {
    log(`${COMPONENT_NAME}: unchanged (${canvas.url ?? canvas.id})`)
    return canvas.id
  }
  const published = (await api.post(`/canvases/${canvas.id}/publish/`, {
    project,
    prompt: 'Install Runner trade-offs from GitHub-Action-Telemetry',
    expected_current_version_id: source?.current_version_id ?? null
  })) as PublishResult
  const status = published?.build?.status ?? 'unknown'
  if (status === 'failed') {
    throw new Error(
      `The canvas build failed: ${JSON.stringify(published.build)}`
    )
  }
  log(
    `${COMPONENT_NAME}: published, build ${status} (${canvas.url ?? canvas.id})`
  )
  return canvas.id
}

export interface Placement {
  id: string
  status: string
  component: string
  x: number
  y: number
  w: number
  h: number
  config: Record<string, unknown>
}

export interface GridLayout {
  schemaVersion?: number
  grid?: { columns: number; rowHeight: number; gap: number }
  placements?: Placement[]
}

export interface CanvasLayoutResponse {
  layout?: GridLayout | null
  current_version_id?: string | null
}

export interface EnsureGridOptions {
  channelId: string
  componentId: string
}

export async function ensureGrid(
  api: Api,
  { channelId, componentId }: EnsureGridOptions,
  log: Logger = console.log
): Promise<string> {
  const grid =
    (await findCanvas(api, channelId, 'grid', GRID_NAME)) ??
    ((await api.post('/canvases/', {
      name: GRID_NAME,
      channel_id: channelId,
      kind: 'grid',
      description: 'CI runner trade-offs'
    })) as CanvasListItem)
  const current = (await api.get(
    `/canvases/${grid.id}/layout/`
  )) as CanvasLayoutResponse | null
  const layout = current?.layout ?? null
  const placements = layout?.placements ?? []
  const existing = placements.find(placement => placement.id === PLACEMENT_ID)
  if (existing && existing.component === componentId) {
    log(`${GRID_NAME}: unchanged`)
    return 'unchanged'
  }
  const bottom = Math.max(0, ...placements.map(p => p.y + p.h))
  const nextPlacements: Placement[] = existing
    ? placements.map(placement =>
        placement.id === PLACEMENT_ID
          ? { ...placement, component: componentId }
          : placement
      )
    : [
        ...placements,
        {
          id: PLACEMENT_ID,
          status: 'live',
          component: componentId,
          x: 0,
          y: bottom,
          w: 12,
          h: 24,
          config: {}
        }
      ]
  await api.post(`/canvases/${grid.id}/layout/publish/`, {
    layout: {
      schemaVersion: 1,
      grid: layout?.grid ?? { columns: 12, rowHeight: 48, gap: 12 },
      placements: nextPlacements
    },
    prompt: existing ? 'Update Runner trade-offs' : 'Add Runner trade-offs',
    expected_current_version_id: current?.current_version_id ?? null
  })
  const status = existing ? 'updated' : 'created'
  log(`${GRID_NAME}: ${status} (${grid.url ?? grid.id})`)
  return status
}

export interface SavedQueryListItem {
  id: string
  name: string
  query?: { query?: string }
}

interface SavedQueryListResponse {
  results?: SavedQueryListItem[]
}

export async function upsertView(
  api: Api,
  name: string,
  sql: string
): Promise<string> {
  const list = (await api.get(
    `/warehouse_saved_queries/?search=${encodeURIComponent(name)}`
  )) as SavedQueryListResponse
  const existing = (list.results ?? []).find(view => view.name === name)
  const query = { kind: 'HogQLQuery', query: sql }
  if (!existing) {
    await api.post('/warehouse_saved_queries/', { name, query })
    return 'created'
  }
  if (existing.query?.query === sql) return 'unchanged'
  await api.patch(`/warehouse_saved_queries/${existing.id}/`, { query })
  return 'updated'
}

export async function installViews(
  api: Api,
  options: RenderOptions,
  log: Logger = console.log
): Promise<void> {
  for (const name of VIEWS) {
    log(`${name}: ${await upsertView(api, name, readView(name, options))}`)
  }
}
