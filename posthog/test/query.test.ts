import { describe, expect, it } from 'vitest'
import { assertRows } from '../checks/query.ts'

describe('assertRows', () => {
  it('fails a boolean column when the actual value is NULL', () => {
    expect(() =>
      assertRows([{ id: 1, flag: null }], [{ id: 1, flag: false }], ['id'])
    ).toThrow()
  })

  it('passes a boolean column when the actual value is 0', () => {
    expect(() =>
      assertRows([{ id: 1, flag: 0 }], [{ id: 1, flag: false }], ['id'])
    ).not.toThrow()
  })

  it('passes a boolean column when the actual value is 1', () => {
    expect(() =>
      assertRows([{ id: 1, flag: 1 }], [{ id: 1, flag: true }], ['id'])
    ).not.toThrow()
  })

  it('compares numbers within a 1e-6 tolerance', () => {
    expect(() =>
      assertRows([{ id: 1, n: 1.0000001 }], [{ id: 1, n: 1 }], ['id'])
    ).not.toThrow()
    expect(() =>
      assertRows([{ id: 1, n: 1.01 }], [{ id: 1, n: 1 }], ['id'])
    ).toThrow()
  })
})
