import { createHash } from 'node:crypto'

export interface PostHogEvent {
  readonly event: string
  readonly distinct_id: string
  readonly uuid: string
  readonly timestamp: string
  readonly properties: Record<string, unknown>
}

// The same parts always give the same uuid, so PostHog can collapse a resent event.
export function eventUuid(...parts: (string | number | bigint)[]): string {
  const hex = createHash('sha256').update(parts.join(':')).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

export async function send(
  events: PostHogEvent[],
  apiKey: string,
  host: string
): Promise<void> {
  const response = await fetch(`${host.replace(/\/$/, '')}/batch/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey, batch: events }),
    signal: AbortSignal.timeout(10_000)
  })
  if (!response.ok)
    throw new Error(`PostHog batch returned HTTP ${response.status}`)
}
