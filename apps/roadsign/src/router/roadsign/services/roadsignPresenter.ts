import type { RoadSign } from '@prisma/roadsign-client'

import {
  isPhotoKind,
  type SignPhoto,
  type RoadSignView
} from '../../../domain/signTypes'

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

export function presentPhoto(
  raw: unknown,
  fallbackKind: SignPhoto['kind']
): SignPhoto | null {
  if (!raw || typeof raw !== 'object') return null
  const rec = raw as Record<string, unknown>
  const url = asNonEmptyString(rec.url)
  if (!url) return null
  const originalUrl = asNonEmptyString(rec.originalUrl) || url
  const id = asNonEmptyString(rec.id) || url
  const kind = isPhotoKind(rec.kind) ? rec.kind : fallbackKind
  const name = asNonEmptyString(rec.name)
  return name
    ? { id, kind, url, originalUrl, name }
    : { id, kind, url, originalUrl }
}

export function presentExtraPhotos(raw: unknown): SignPhoto[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => presentPhoto(item, 'extra'))
    .filter((item): item is SignPhoto => item !== null)
}

export function presentRoadSign(row: RoadSign): RoadSignView {
  return {
    id: String(row.id),
    name: row.name,
    roadName: row.roadName || '',
    description: row.description,
    extra: row.extra,
    type: row.type,
    status: row.status,
    direction: row.direction,
    level: row.level,
    signPhoto: presentPhoto(row.signPhoto, 'sign'),
    extraPhotos: presentExtraPhotos(row.extraPhotos),
    lng: row.lng,
    lat: row.lat,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  }
}
