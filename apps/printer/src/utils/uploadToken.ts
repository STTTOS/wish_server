import jwt from 'jsonwebtoken'

import { UPLOAD_TOKEN_TTL_SECONDS } from '../config'

const UPLOAD_TOKEN_TYP = 'mp_upload' as const

export type UploadTokenPayload = {
  typ: typeof UPLOAD_TOKEN_TYP
  openid: string
  shopCode: string
}

export function issueUploadToken(input: {
  openid: string
  shopCode: string
}): { token: string; expiresIn: number } {
  const secret = process.env.SECRET_KEY
  if (!secret) {
    throw new Error('SECRET_KEY is required')
  }

  const payload: UploadTokenPayload = {
    typ: UPLOAD_TOKEN_TYP,
    openid: input.openid,
    shopCode: input.shopCode
  }

  const token = jwt.sign(payload, secret, {
    expiresIn: UPLOAD_TOKEN_TTL_SECONDS
  } as jwt.SignOptions)

  return { token, expiresIn: UPLOAD_TOKEN_TTL_SECONDS }
}

export function verifyUploadToken(token: string): UploadTokenPayload {
  const secret = process.env.SECRET_KEY
  if (!secret) {
    throw Object.assign(new Error('SECRET_KEY is required'), { status: 500 })
  }

  let decoded: unknown
  try {
    decoded = jwt.verify(token, secret)
  } catch {
    throw Object.assign(new Error('上传凭证无效或已过期'), { status: 401 })
  }

  if (!decoded || typeof decoded !== 'object') {
    throw Object.assign(new Error('上传凭证无效或已过期'), { status: 401 })
  }

  const payload = decoded as Partial<UploadTokenPayload>
  if (
    payload.typ !== UPLOAD_TOKEN_TYP ||
    typeof payload.openid !== 'string' ||
    !payload.openid ||
    typeof payload.shopCode !== 'string' ||
    !payload.shopCode
  ) {
    throw Object.assign(new Error('上传凭证无效或已过期'), { status: 401 })
  }

  return {
    typ: UPLOAD_TOKEN_TYP,
    openid: payload.openid,
    shopCode: payload.shopCode
  }
}

/** 从 Authorization / X-Upload-Token / form 字段提取上传凭证 */
export function extractUploadToken(input: {
  authorization?: string
  uploadTokenHeader?: string
  formToken?: unknown
}): string {
  const fromHeader = (input.uploadTokenHeader || '').trim()
  if (fromHeader) return fromHeader

  const auth = (input.authorization || '').trim()
  const bearer = auth.match(/^Bearer\s+(.+)$/i)
  if (bearer?.[1]) return bearer[1].trim()

  if (typeof input.formToken === 'string' && input.formToken.trim()) {
    return input.formToken.trim()
  }

  return ''
}
