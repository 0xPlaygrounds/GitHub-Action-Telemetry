export interface ApiOptions {
  host: string
  projectId: string
  apiKey: string
  fetchImpl?: typeof fetch
}

export interface Api {
  get: (path: string) => Promise<unknown>
  post: (path: string, body?: unknown) => Promise<unknown>
  patch: (path: string, body?: unknown) => Promise<unknown>
}

export function createApi({
  host,
  projectId,
  apiKey,
  fetchImpl = fetch
}: ApiOptions): Api {
  async function request(
    method: string,
    path: string,
    body?: unknown
  ): Promise<unknown> {
    const response = await fetchImpl(
      `${host}/api/projects/${projectId}${path}`,
      {
        method,
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json'
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(60_000)
      }
    )
    const text = await response.text()
    if (!response.ok) {
      throw new Error(
        `${method} ${path} returned HTTP ${response.status}: ${text}`
      )
    }
    const parsed: unknown = text ? JSON.parse(text) : null
    return parsed
  }
  return {
    get: async path => request('GET', path),
    post: async (path, body) => request('POST', path, body),
    patch: async (path, body) => request('PATCH', path, body)
  }
}
