import type { Road } from '@prisma/roadsign-client'
import type { ApiResult } from '../../../utils/apiResult'

import { withList } from '../../../utils/response'
import { ok, fail } from '../../../utils/apiResult'
import { HTTP_STATUS } from '../../../constants/httpStatus'
import { roadRepository } from '../../../repositories/roadRepository'
import {
  validateRoadId,
  validateRoadCreate,
  validateRoadUpdate
} from './roadValidator'

export type RoadView = {
  id: string
  name: string
  sort: number
  createdAt: string
  updatedAt: string
}

function presentRoad(row: Road): RoadView {
  return {
    id: String(row.id),
    name: row.name,
    sort: row.sort,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  }
}

export async function listRoadsFacade() {
  const list = await roadRepository.list()
  return ok(withList(list.map(presentRoad), list.length))
}

export async function createRoadFacade(
  body: Record<string, unknown>
): Promise<ApiResult<RoadView>> {
  const validated = validateRoadCreate(body)
  if (!validated.ok) return validated

  const exists = await roadRepository.findByName(validated.data.name)
  if (exists) {
    return fail(HTTP_STATUS.CONFLICT, '道路名称已存在')
  }

  const row = await roadRepository.create(validated.data)
  return ok(presentRoad(row))
}

export async function updateRoadFacade(
  body: Record<string, unknown>
): Promise<ApiResult<RoadView>> {
  const validated = validateRoadUpdate(body)
  if (!validated.ok) return validated

  const existing = await roadRepository.findById(validated.data.id)
  if (!existing) {
    return fail(HTTP_STATUS.NOT_FOUND, '道路不存在')
  }

  if (validated.data.name && validated.data.name !== existing.name) {
    const conflict = await roadRepository.findByName(validated.data.name)
    if (conflict) {
      return fail(HTTP_STATUS.CONFLICT, '道路名称已存在')
    }
  }

  const row = await roadRepository.update(validated.data.id, {
    name: validated.data.name,
    sort: validated.data.sort
  })

  if (validated.data.name && validated.data.name !== existing.name) {
    await roadRepository.renameSignsRoad(existing.name, validated.data.name)
  }

  return ok(presentRoad(row))
}

export async function deleteRoadFacade(id: unknown): Promise<ApiResult<null>> {
  const validated = validateRoadId(id)
  if (!validated.ok) return validated

  const existing = await roadRepository.findById(validated.data.id)
  if (!existing) {
    return fail(HTTP_STATUS.NOT_FOUND, '道路不存在')
  }

  const used = await roadRepository.countSignsByRoadName(existing.name)
  if (used > 0) {
    return fail(
      HTTP_STATUS.CONFLICT,
      `该道路下还有 ${used} 个路牌，请先改绑或删除点位`
    )
  }

  await roadRepository.delete(validated.data.id)
  return ok(null)
}
