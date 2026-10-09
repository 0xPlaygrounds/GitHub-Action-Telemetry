import { VIEWS, readView } from './sql.mjs'

export async function upsertView(api, name, sql) {
  const list = await api.get(
    `/warehouse_saved_queries/?search=${encodeURIComponent(name)}`
  )
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

export async function installViews(api, options, log = console.log) {
  for (const name of VIEWS) {
    log(`${name}: ${await upsertView(api, name, readView(name, options))}`)
  }
}
