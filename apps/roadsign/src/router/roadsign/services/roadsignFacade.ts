import type { ApiResult } from '../../../utils/apiResult'
import type { RoadSignView } from '../../../domain/signTypes'

import { withList } from '../../../utils/response'
import { ok, fail } from '../../../utils/apiResult'
import { presentRoadSign } from './roadsignPresenter'
import { HTTP_STATUS } from '../../../constants/httpStatus'
import { roadRepository } from '../../../repositories/roadRepository'
import { roadsignRepository } from '../../../repositories/roadsignRepository'
import {
  validateRoadSignId,
  validateRoadSignCreate,
  validateRoadSignUpdate,
  validateRoadSignListQuery
} from './roadsignValidator'

async function assertRoadExists(roadName: string): Promise<ApiResult<null>> {
  const road = await roadRepository.findByName(roadName)
  if (!road) {
    return fail(HTTP_STATUS.BAD_REQUEST, '路名不存在，请先在道路管理中添加')
  }
  return ok(null)
}

export async function listRoadSignsFacade(query: Record<string, unknown>) {
  const validated = validateRoadSignListQuery(query)
  if (!validated.ok) return validated

  const { total, list } = await roadsignRepository.list(validated.data)
  return ok(withList(list.map(presentRoadSign), total))
}

export async function getRoadSignFacade(
  id: unknown
): Promise<ApiResult<RoadSignView>> {
  const validated = validateRoadSignId(id)
  if (!validated.ok) return validated

  const record = await roadsignRepository.findById(validated.data.id)
  if (!record) {
    return fail(HTTP_STATUS.NOT_FOUND, '路牌不存在')
  }
  return ok(presentRoadSign(record))
}

export async function createRoadSignFacade(
  body: Record<string, unknown>
): Promise<ApiResult<RoadSignView>> {
  const validated = validateRoadSignCreate(body)
  if (!validated.ok) return validated

  const roadOk = await assertRoadExists(validated.data.roadName)
  if (!roadOk.ok) return roadOk

  const record = await roadsignRepository.create(validated.data)
  return ok(presentRoadSign(record))
}

export async function updateRoadSignFacade(
  body: Record<string, unknown>
): Promise<ApiResult<RoadSignView>> {
  const validated = validateRoadSignUpdate(body)
  if (!validated.ok) return validated

  const existing = await roadsignRepository.findById(validated.data.id)
  if (!existing) {
    return fail(HTTP_STATUS.NOT_FOUND, '路牌不存在')
  }

  const roadOk = await assertRoadExists(validated.data.roadName)
  if (!roadOk.ok) return roadOk

  const record = await roadsignRepository.update(validated.data)
  return ok(presentRoadSign(record))
}

export async function deleteRoadSignFacade(
  id: unknown
): Promise<ApiResult<null>> {
  const validated = validateRoadSignId(id)
  if (!validated.ok) return validated

  const existing = await roadsignRepository.findById(validated.data.id)
  if (!existing) {
    return fail(HTTP_STATUS.NOT_FOUND, '路牌不存在')
  }

  await roadsignRepository.delete(validated.data.id)
  return ok(null)
}
