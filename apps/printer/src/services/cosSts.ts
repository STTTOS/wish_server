import STS from 'qcloud-cos-sts'

import {
  DEFAULT_COS_BUCKET,
  DEFAULT_COS_REGION
} from '@wishufree/cos-upload'

import { PRINTING_COS_PREFIX } from '../config'
import { getCosUploadClient } from './cosUpload'

/** STS 临时钥有效期（秒） */
const STS_DURATION_SECONDS = Number(process.env.COS_STS_DURATION_SECONDS || 30 * 60)

const ALLOW_ACTIONS = [
  'name/cos:PutObject',
  'name/cos:PostObject',
  'name/cos:InitiateMultipartUpload',
  'name/cos:ListMultipartUploads',
  'name/cos:ListParts',
  'name/cos:UploadPart',
  'name/cos:CompleteMultipartUpload',
  'name/cos:AbortMultipartUpload'
]

function assertCosSecrets() {
  const secretId = process.env.COS_SECRET_ID || ''
  const secretKey = process.env.COS_SECRET_KEY || ''
  if (!secretId || !secretKey) {
    throw Object.assign(new Error('服务未配置 COS 密钥'), { status: 503 })
  }
  return { secretId, secretKey }
}

/**
 * 为指定对象 Key 签发短时 STS（仅允许该 Key 的上传/分片操作）。
 */
export async function issuePrintUploadSts(input: {
  shopCode: string
  cosKey: string
}) {
  const { secretId, secretKey } = assertCosSecrets()
  const cos = getCosUploadClient()
  const bucket = cos.bucket || DEFAULT_COS_BUCKET
  const region = cos.region || DEFAULT_COS_REGION
  const shopCode = input.shopCode.trim()
  const cosKey = input.cosKey.replace(/^\/+/, '').trim()

  const prefix = `${PRINTING_COS_PREFIX}/${shopCode}/`
  if (!cosKey.startsWith(prefix)) {
    throw Object.assign(new Error('cosKey 与店铺不匹配'), { status: 403 })
  }

  const policy = STS.getPolicy([
    {
      action: ALLOW_ACTIONS,
      bucket,
      region,
      prefix: cosKey
    }
  ])

  const data = await STS.getCredential({
    secretId,
    secretKey,
    durationSeconds: STS_DURATION_SECONDS,
    policy
  })

  return {
    bucket,
    region,
    cosKey,
    credentials: {
      tmpSecretId: data.credentials.tmpSecretId,
      tmpSecretKey: data.credentials.tmpSecretKey,
      sessionToken: data.credentials.sessionToken
    },
    startTime: data.startTime,
    expiredTime: data.expiredTime
  }
}
