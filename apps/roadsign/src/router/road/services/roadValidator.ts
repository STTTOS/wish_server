import type { ApiResult } from '../../../utils/apiResult'

import { ok, fail } from '../../../utils/apiResult'
import { HTTP_STATUS } from '../../../constants/httpStatus'

function asSingle(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value
}

export function validateRoadId(id: unknown): ApiResult<{ id: number }> {
  const raw = asSingle(id)
  const n = typeof raw === 'string' ? Number(raw) : raw
  if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0) {
    return fail(HTTP_STATUS.BAD_REQUEST, '道路 id 无效')
  }
  return ok({ id: n })
}

export function validateRoadName(
  value: unknown,
  required = true
): ApiResult<string> {
  const raw = asSingle(value)
  if (raw === undefined || raw === null || raw === '') {
    if (required) return fail(HTTP_STATUS.BAD_REQUEST, '道路名称不能为空')
    return ok('')
  }
  if (typeof raw !== 'string') {
    return fail(HTTP_STATUS.BAD_REQUEST, '道路名称格式不正确')
  }
  const trimmed = raw.trim()
  if (!trimmed) {
    return fail(HTTP_STATUS.BAD_REQUEST, '道路名称不能为空')
  }
  if (trimmed.length > 100) {
    return fail(HTTP_STATUS.BAD_REQUEST, '道路名称过长')
  }
  return ok(trimmed)
}

export function validateRoadCreate(body: Record<string, unknown>): ApiResult<{
  name: string
  sort: number
}> {
  const name = validateRoadName(body.name, true)
  if (!name.ok) return name

  const sortRaw = asSingle(body.sort)
  let sort = 0
  if (sortRaw !== undefined && sortRaw !== null && sortRaw !== '') {
    const n = typeof sortRaw === 'string' ? Number(sortRaw) : sortRaw
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) {
      return fail(HTTP_STATUS.BAD_REQUEST, '排序值无效')
    }
    sort = n
  }

  return ok({ name: name.data, sort })
}

export function validateRoadUpdate(body: Record<string, unknown>): ApiResult<{
  id: number
  name?: string
  sort?: number
}> {
  const id = validateRoadId(body.id)
  if (!id.ok) return id

  const data: { id: number; name?: string; sort?: number } = { id: id.data.id }

  if (body.name !== undefined) {
    const name = validateRoadName(body.name, true)
    if (!name.ok) return name
    data.name = name.data
  }

  if (body.sort !== undefined) {
    const sortRaw = asSingle(body.sort)
    const n = typeof sortRaw === 'string' ? Number(sortRaw) : sortRaw
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) {
      return fail(HTTP_STATUS.BAD_REQUEST, '排序值无效')
    }
    data.sort = n
  }

  if (data.name === undefined && data.sort === undefined) {
    return fail(HTTP_STATUS.BAD_REQUEST, '没有可更新的字段')
  }

  return ok(data)
}
