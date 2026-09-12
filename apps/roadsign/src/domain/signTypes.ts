export const SIGN_TYPES = ['existing', 'planned'] as const
export const SIGN_STATUSES = ['todo', 'doing', 'done'] as const
export const SIGN_DIRECTIONS = ['ew', 'we', 'ns', 'sn'] as const
export const SIGN_LEVELS = ['l1', 'l2'] as const
export const PHOTO_KINDS = ['sign', 'extra'] as const

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
