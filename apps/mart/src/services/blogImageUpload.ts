import jwt from 'jsonwebtoken'
import { basename } from 'path'
import { readFile } from 'fs/promises'

import { logger } from '../logger'
import { blogBaseUrl, blogSecretKey, blogAdminUserId } from '../config'

export type BlogUploadedImage = {
  url: string
  originalUrl: string
  filename: string | null
}

type UploadedFile = {
  filepath: string
  originalFilename?: string | null
  mimetype?: string | null
}

type BlogEnvelope = {
  code?: number
  msg?: string
  data?: BlogUploadedImage | null
}

function createBlogUploadToken() {
  if (!blogSecretKey) {
    throw new Error('BLOG_SECRET_KEY 未配置，无法转发图片上传')
  }
  if (!blogAdminUserId || blogAdminUserId <= 0) {
    throw new Error('BLOG_ADMIN_USER_ID 未配置，无法转发图片上传')
  }
  // blog 侧 requireAuth 查库确认 admin；session 校验仅在 loginUsers 有记录时生效
  return jwt.sign({ id: blogAdminUserId }, blogSecretKey, {
    expiresIn: '2h'
  })
}

/**
 * 转发单文件到 blog `/api/common/upload_image`。
 * 复用 blog 的 sharp 压缩与 COS 上传能力。
 */
export async function uploadImageViaBlog(
  file: UploadedFile
): Promise<BlogUploadedImage> {
  const token = createBlogUploadToken()
  const bytes = await readFile(file.filepath)
  const filename = file.originalFilename || basename(file.filepath)
  const blob = new Blob([bytes], {
    type: file.mimetype || 'application/octet-stream'
  })

  const form = new FormData()
  form.append('file', blob, filename)

  const url = `${blogBaseUrl.replace(/\/$/, '')}/api/common/upload_image`
  logger.info(`[blog-upload] POST ${url}, file=${filename}`)

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Cookie: `token=${token}`,
      Authorization: `Bearer ${token}`
    },
    body: form
  })

  let envelope: BlogEnvelope | null = null
  try {
    envelope = (await response.json()) as BlogEnvelope
  } catch {
    throw new Error('blog 上传响应解析失败')
  }

  if (!response.ok || envelope?.code !== 200 || !envelope.data?.url) {
    throw new Error(envelope?.msg || `blog 上传失败 (${response.status})`)
  }

  return envelope.data
}
