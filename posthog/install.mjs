#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { createApi } from './lib/api.mjs'
import { ensureGrid, installViews, upsertComponent } from './lib/install.mjs'

const { values } = parseArgs({
  options: {
    project: { type: 'string' },
    channel: { type: 'string' },
    'window-days': { type: 'string', default: '14' },
    baseline: { type: 'string', default: 'ubuntu-latest' }
  }
})
const apiKey = process.env.POSTHOG_PERSONAL_API_KEY
if (!values.project || !apiKey) {
  console.error(
    'Usage: POSTHOG_PERSONAL_API_KEY=... node posthog/install.mjs --project <id> ' +
      '[--channel <id>] [--window-days 14] [--baseline ubuntu-latest]'
  )
  process.exit(1)
}

const api = createApi({
  host: process.env.POSTHOG_HOST ?? 'https://us.posthog.com',
  projectId: values.project,
  apiKey
})
const options = {
  windowDays: Number(values['window-days']),
  baselineLabel: values.baseline
}
await installViews(api, options)
if (values.channel) {
  const componentId = await upsertComponent(api, {
    channelId: values.channel,
    settings: options
  })
  await ensureGrid(api, { channelId: values.channel, componentId })
} else {
  console.log('No --channel: the views are installed, the canvas is not.')
}
