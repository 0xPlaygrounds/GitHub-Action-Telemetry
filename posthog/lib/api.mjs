export function createApi({ host, projectId, apiKey, fetchImpl = fetch }) {
  async function request(method, path, body) {
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
      throw new Error(`${method} ${path} returned HTTP ${response.status}: ${text}`)
    }
    return text ? JSON.parse(text) : null
  }
  return {
    get: async path => request('GET', path),
    post: async (path, body) => request('POST', path, body),
    patch: async (path, body) => request('PATCH', path, body)
  }
}
