export const SIGN_TYPES = ['existing', 'planned'] as const
export const SIGN_STATUSES = ['todo', 'doing', 'done'] as const
export const SIGN_DIRECTIONS = [
  'ew',
  'we',
  'ns',
  'sn',
  'ew_one',
  'we_one',
  'ns_one',
  'sn_one'
] as const
export const SIGN_LEVELS = ['l1', 'l2'] as const
export const PHOTO_KINDS = ['sign', 'extra'] as const
export const ONE_WAY_DIRECTIONS = [
  'ew_one',
  'we_one',
  'ns_one',
  'sn_one'
] as const

export type SignType = (typeof SIGN_TYPES)[number]
export type SignStatus = (typeof SIGN_STATUSES)[number]
export type SignDirection = (typeof SIGN_DIRECTIONS)[number]
export type SignLevel = (typeof SIGN_LEVELS)[number]
export type PhotoKind = (typeof PHOTO_KINDS)[number]

export type SignPhoto = {
  id: string
  kind: PhotoKind
  url: string
  originalUrl: string
  name?: string
}

export type RoadSignView = {
  id: string
  name: string
  roadName: string
  description: string
  extra: string
  type: SignType
  status: SignStatus
  direction: SignDirection
  /** 单向指向距离（米）；双向为空 */
  distanceM: number | null
  level: SignLevel
  signPhoto: SignPhoto | null
  extraPhotos: SignPhoto[]
  lng: number
  lat: number
  createdAt: string
  updatedAt: string
}

export function isSignType(value: unknown): value is SignType {
  return (
    typeof value === 'string' &&
    (SIGN_TYPES as readonly string[]).includes(value)
  )
}

export function isSignStatus(value: unknown): value is SignStatus {
  return (
    typeof value === 'string' &&
    (SIGN_STATUSES as readonly string[]).includes(value)
  )
}

export function isSignDirection(value: unknown): value is SignDirection {
  return (
    typeof value === 'string' &&
    (SIGN_DIRECTIONS as readonly string[]).includes(value)
  )
}

export function isSignLevel(value: unknown): value is SignLevel {
  return (
    typeof value === 'string' &&
    (SIGN_LEVELS as readonly string[]).includes(value)
  )
}

export function isPhotoKind(value: unknown): value is PhotoKind {
  return (
    typeof value === 'string' &&
    (PHOTO_KINDS as readonly string[]).includes(value)
  )
}

export function isOneWayDirection(value: SignDirection): boolean {
  return (ONE_WAY_DIRECTIONS as readonly string[]).includes(value)
}

/** 单向对向：西东↔东西、北南↔南北 */
export function oneWayOppositeDirection(
  direction: SignDirection
): SignDirection | null {
  if (direction === 'we_one') return 'ew_one'
  if (direction === 'ew_one') return 'we_one'
  if (direction === 'ns_one') return 'sn_one'
  if (direction === 'sn_one') return 'ns_one'
  return null
}

/** 同名单向对向：西东/东西、北南/南北 */
export function oneWayDistanceGroup(
  direction: SignDirection
): SignDirection[] | null {
  const opposite = oneWayOppositeDirection(direction)
  if (!opposite) return null
  return [direction, opposite]
}

/** 同一汇入口对向配对半径（米） */
export const ONE_WAY_PAIR_RADIUS_M = 150

export function haversineMeters(
  lng1: number,
  lat1: number,
  lng2: number,
  lat2: number
): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const φ1 = toRad(lat1)
  const φ2 = toRad(lat2)
  const Δφ = toRad(lat2 - lat1)
  const Δλ = toRad(lng2 - lng1)
  const a =
    Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}
