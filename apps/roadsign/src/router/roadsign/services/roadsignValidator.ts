import type { ApiResult } from '../../../utils/apiResult'
import type {
  SignType,
  SignLevel,
  SignPhoto,
  SignStatus,
  SignDirection
} from '../../../domain/signTypes'

import { ok, fail } from '../../../utils/apiResult'
import { HTTP_STATUS } from '../../../constants/httpStatus'
import {
  isSignType,
  isPhotoKind,
  isSignLevel,
  isSignStatus,
  isSignDirection
} from '../../../domain/signTypes'

const MAX_EXTRA_PHOTOS = 20

export type RoadSignWriteData = {
  name: string
  roadName: string
  description: string
  extra: string
  type: SignType
  status: SignStatus
  direction: SignDirection
  level: SignLevel
  signPhoto: SignPhoto | null
  extraPhotos: SignPhoto[]
  lng: number
  lat: number
}

export type RoadSignUpdateData = RoadSignWriteData & { id: number }

export type RoadSignListQuery = {
  keyword?: string
  roadName?: string
  statuses: SignStatus[]
  type?: SignType
  direction?: SignDirection
  level?: SignLevel
  page: number
  pageSize: number
}

function asSingle(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value
}

function parseId(value: unknown): ApiResult<number> {
  const raw = asSingle(value)
  const n = typeof raw === 'string' ? Number(raw) : raw
  if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0) {
    return fail(HTTP_STATUS.BAD_REQUEST, '路牌 id 无效')
  }
  return ok(n)
}

function parseOptionalString(
  value: unknown,
  options: { maxLength: number; field: string; required?: boolean }
): ApiResult<string> {
  const raw = asSingle(value)
  if (raw === undefined || raw === null) {
    if (options.required) {
      return fail(HTTP_STATUS.BAD_REQUEST, `${options.field}不能为空`)
    }
    return ok('')
  }
  if (typeof raw !== 'string') {
    return fail(HTTP_STATUS.BAD_REQUEST, `${options.field}格式不正确`)
  }
  const trimmed = raw.trim()
  if (options.required && !trimmed) {
    return fail(HTTP_STATUS.BAD_REQUEST, `${options.field}不能为空`)
  }
  if (trimmed.length > options.maxLength) {
    return fail(HTTP_STATUS.BAD_REQUEST, `${options.field}过长`)
  }
  return ok(trimmed)
}

function parseLngLat(
  lngRaw: unknown,
  latRaw: unknown
): ApiResult<{ lng: number; lat: number }> {
  const lng = Number(asSingle(lngRaw))
  const lat = Number(asSingle(latRaw))
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    return fail(HTTP_STATUS.BAD_REQUEST, '经度无效')
  }
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    return fail(HTTP_STATUS.BAD_REQUEST, '纬度无效')
  }
  return ok({ lng, lat })
}

function parsePhoto(
  raw: unknown,
  kind: SignPhoto['kind']
): ApiResult<SignPhoto> {
  if (!raw || typeof raw !== 'object') {
    return fail(HTTP_STATUS.BAD_REQUEST, '照片格式不正确')
  }
  const rec = raw as Record<string, unknown>
  const url = typeof rec.url === 'string' ? rec.url.trim() : ''
  if (!url) return fail(HTTP_STATUS.BAD_REQUEST, '照片地址不能为空')
  const originalUrl =
    typeof rec.originalUrl === 'string' && rec.originalUrl.trim()
      ? rec.originalUrl.trim()
      : url
  const id = typeof rec.id === 'string' && rec.id.trim() ? rec.id.trim() : url
  const resolvedKind = isPhotoKind(rec.kind) ? rec.kind : kind
  const name =
    typeof rec.name === 'string' && rec.name.trim()
      ? rec.name.trim()
      : undefined
  return ok(
    name
      ? { id, kind: resolvedKind, url, originalUrl, name }
      : { id, kind: resolvedKind, url, originalUrl }
  )
}

function parseSignPhoto(value: unknown): ApiResult<SignPhoto | null> {
  if (value === undefined || value === null || value === '') return ok(null)
  return parsePhoto(value, 'sign')
}

function parseExtraPhotos(value: unknown): ApiResult<SignPhoto[]> {
  if (value === undefined || value === null || value === '') return ok([])
  if (!Array.isArray(value)) {
    return fail(HTTP_STATUS.BAD_REQUEST, '附带照片格式不正确')
  }
  if (value.length > MAX_EXTRA_PHOTOS) {
    return fail(HTTP_STATUS.BAD_REQUEST, `附带照片最多 ${MAX_EXTRA_PHOTOS} 张`)
  }
  const photos: SignPhoto[] = []
  for (const item of value) {
    const parsed = parsePhoto(item, 'extra')
    if (!parsed.ok) return parsed
    photos.push(parsed.data)
  }
  return ok(photos)
}

function parseEnum<T extends string>(
  value: unknown,
  check: (v: unknown) => v is T,
  message: string
): ApiResult<T> {
  const raw = asSingle(value)
  if (!check(raw)) return fail(HTTP_STATUS.BAD_REQUEST, message)
  return ok(raw)
}

function parseWriteBody(
  body: Record<string, unknown>
): ApiResult<RoadSignWriteData> {
  const name = parseOptionalString(body.name, {
    maxLength: 200,
    field: '名称',
    required: true
  })
  if (!name.ok) return name

  const roadName = parseOptionalString(body.roadName, {
    maxLength: 100,
    field: '路名',
    required: true
  })
  if (!roadName.ok) return roadName

  const description = parseOptionalString(body.description, {
    maxLength: 1000,
    field: '描述'
  })
  if (!description.ok) return description

  const extra = parseOptionalString(body.extra, {
    maxLength: 4000,
    field: '附带信息'
  })
  if (!extra.ok) return extra

  const type = parseEnum(body.type, isSignType, '类型无效')
  if (!type.ok) return type

  const status = parseEnum(body.status ?? 'todo', isSignStatus, '状态无效')
  if (!status.ok) return status

  const direction = parseEnum(body.direction, isSignDirection, '方向无效')
  if (!direction.ok) return direction

  const level = parseEnum(body.level, isSignLevel, '路牌级别无效')
  if (!level.ok) return level

  const coord = parseLngLat(body.lng, body.lat)
  if (!coord.ok) return coord

  const signPhoto = parseSignPhoto(body.signPhoto)
  if (!signPhoto.ok) return signPhoto

  const extraPhotos = parseExtraPhotos(body.extraPhotos)
  if (!extraPhotos.ok) return extraPhotos

  return ok({
    name: name.data,
    roadName: roadName.data,
    description: description.data,
    extra: extra.data,
    type: type.data,
    status: status.data,
    direction: direction.data,
    level: level.data,
    signPhoto: signPhoto.data,
    extraPhotos: extraPhotos.data,
    lng: coord.data.lng,
    lat: coord.data.lat
  })
}

export function validateRoadSignId(id: unknown): ApiResult<{ id: number }> {
  const parsed = parseId(id)
  if (!parsed.ok) return parsed
  return ok({ id: parsed.data })
}

export function validateRoadSignCreate(
  body: Record<string, unknown>
): ApiResult<RoadSignWriteData> {
  return parseWriteBody(body)
}

export function validateRoadSignUpdate(
  body: Record<string, unknown>
): ApiResult<RoadSignUpdateData> {
  const id = parseId(body.id)
  if (!id.ok) return id
  const data = parseWriteBody(body)
  if (!data.ok) return data
  return ok({ id: id.data, ...data.data })
}

function parseCsvOrList(value: unknown): string[] {
  if (value === undefined || value === null || value === '') return []
  const items = Array.isArray(value) ? value : [value]
  return items
    .flatMap((item) => String(item).split(','))
    .map((item) => item.trim())
    .filter(Boolean)
}

export function validateRoadSignListQuery(query: {
  keyword?: unknown
  q?: unknown
  roadName?: unknown
  status?: unknown
  type?: unknown
  direction?: unknown
  level?: unknown
  page?: unknown
  pageSize?: unknown
}): ApiResult<RoadSignListQuery> {
  const keywordRaw = asSingle(query.keyword ?? query.q)
  const keyword =
    typeof keywordRaw === 'string' && keywordRaw.trim()
      ? keywordRaw.trim()
      : undefined

  const roadNameRaw = asSingle(query.roadName)
  const roadName =
    typeof roadNameRaw === 'string' && roadNameRaw.trim()
      ? roadNameRaw.trim()
      : undefined

  const statuses: SignStatus[] = []
  for (const item of parseCsvOrList(query.status)) {
    if (!isSignStatus(item)) {
      return fail(HTTP_STATUS.BAD_REQUEST, '状态筛选无效')
    }
    statuses.push(item)
  }

  const typeRaw = asSingle(query.type)
  if (typeRaw !== undefined && typeRaw !== null && typeRaw !== '') {
    if (!isSignType(typeRaw)) {
      return fail(HTTP_STATUS.BAD_REQUEST, '类型筛选无效')
    }
  }

  const directionRaw = asSingle(query.direction)
  if (
    directionRaw !== undefined &&
    directionRaw !== null &&
    directionRaw !== ''
  ) {
    if (!isSignDirection(directionRaw)) {
      return fail(HTTP_STATUS.BAD_REQUEST, '方向筛选无效')
    }
  }

  const levelRaw = asSingle(query.level)
  if (levelRaw !== undefined && levelRaw !== null && levelRaw !== '') {
    if (!isSignLevel(levelRaw)) {
      return fail(HTTP_STATUS.BAD_REQUEST, '级别筛选无效')
    }
  }

  const pageRaw = asSingle(query.page)
  const pageSizeRaw = asSingle(query.pageSize)
  const page =
    pageRaw === undefined || pageRaw === null || pageRaw === ''
      ? 1
      : Number(pageRaw)
  const pageSize =
    pageSizeRaw === undefined || pageSizeRaw === null || pageSizeRaw === ''
      ? 500
      : Number(pageSizeRaw)

  if (
    !Number.isInteger(page) ||
    page <= 0 ||
    !Number.isInteger(pageSize) ||
    pageSize <= 0 ||
    pageSize > 500
  ) {
    return fail(HTTP_STATUS.BAD_REQUEST, '分页参数异常')
  }

  return ok({
    keyword,
    roadName,
    statuses,
    type: isSignType(typeRaw) ? typeRaw : undefined,
    direction: isSignDirection(directionRaw) ? directionRaw : undefined,
    level: isSignLevel(levelRaw) ? levelRaw : undefined,
    page,
    pageSize
  })
}
