import { basename } from 'path'

/** Customer-facing print intent from public upload (mini program / H5). */
export type PublicPrintOptions = {
  color: 'bw' | 'color'
  paperSize: 'A4' | 'A3'
  duplex: boolean
  copies: number
}

export class PrintOptionsParseError extends Error {
  status = 400
  constructor(message: string) {
    super(message)
    this.name = 'PrintOptionsParseError'
  }
}

export function guessMime(ext: string, fallback?: string | null) {
  const map: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx':
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx':
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.cdr': 'application/x-coreldraw',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.tif': 'image/tiff',
    '.tiff': 'image/tiff'
  }
  return map[ext] || fallback || 'application/octet-stream'
}

export function sanitizeFileName(name: string) {
  return name.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 180)
}

/**
 * Prefer explicit client `fileName` / `originalName`; fall back to basename.
 */
export function resolveOriginalName(
  preferred: unknown,
  fallbackName?: string | null,
  fallback = 'file'
): string {
  const fromForm =
    typeof preferred === 'string' && preferred.trim() ? preferred.trim() : ''
  const raw = fromForm || (fallbackName || '').trim() || fallback
  const base = basename(raw)
  return base.slice(0, 500) || fallback
}

function parseDuplex(raw: unknown): boolean {
  if (typeof raw === 'boolean') return raw
  if (typeof raw === 'number') return raw !== 0
  if (typeof raw === 'string') {
    const v = raw.trim().toLowerCase()
    if (v === 'true' || v === '1' || v === 'yes') return true
    if (v === 'false' || v === '0' || v === 'no' || v === '') return false
  }
  return false
}

/**
 * Accept JSON object or JSON string.
 * - missing / empty → null (shop defaults on desk)
 * - malformed JSON / non-object → 400
 * - object with bad fields → coerce to safe defaults
 */
export function parsePublicPrintOptions(
  raw: unknown
): PublicPrintOptions | null {
  if (raw == null) return null
  if (typeof raw === 'string' && !raw.trim()) return null

  let value: unknown = raw
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw.trim())
    } catch {
      throw new PrintOptionsParseError('printOptions 不是合法 JSON')
    }
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PrintOptionsParseError('printOptions 必须是对象')
  }

  const obj = value as Record<string, unknown>

  const color: PublicPrintOptions['color'] =
    obj.color === 'color' ? 'color' : 'bw'

  const paperSize: PublicPrintOptions['paperSize'] =
    obj.paperSize === 'A3' ? 'A3' : 'A4'

  const duplex = parseDuplex(obj.duplex)

  const copiesRaw = obj.copies
  const copiesNum =
    typeof copiesRaw === 'number'
      ? copiesRaw
      : typeof copiesRaw === 'string'
        ? Number(copiesRaw)
        : NaN
  const copies = Number.isFinite(copiesNum)
    ? Math.min(99, Math.max(1, Math.floor(copiesNum)))
    : 1

  return { color, paperSize, duplex, copies }
}
