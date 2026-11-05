import { promises as fs } from 'fs'

import router from '../instance'
import { logger } from '../../logger'
import response from '../../utils/response'
import { apiPrefixClient } from '../../config'
import combinePath from '../../utils/combinePath'
import { HTTP_STATUS } from '../../constants/httpStatus'
import { getCosUploadClient } from '../../services/cosUpload'
import {
  removeUserPushToken,
  upsertUserPushToken,
  isValidExpoPushToken,
  normalizePushPlatform
} from '../../services/pushNotifications'
import {
  setProfileHighlight,
  clearProfileHighlight,
  listGuestbookMessages,
  listProfileHighlights,
  markGuestbookWallRead,
  createGuestbookMessage,
  deleteGuestbookMessage,
  getGuestbookUnreadCount,
  normalizeGuestbookContent,
  PROFILE_GUESTBOOK_MAX_CHARS
} from '../../services/profileSocial'

const userClientApi = combinePath(apiPrefixClient)('/user')

type UploadedFile = {
  filepath?: string
  originalFilename?: string | null
  mimetype?: string | null
  size?: number
  newFilename?: string
  buffer?: Buffer
}

function pickSingleFile(files: unknown): UploadedFile | null {
  if (!files || typeof files !== 'object') return null
  const raw = (files as { file?: UploadedFile | UploadedFile[] }).file
  if (!raw) return null
  return Array.isArray(raw) ? raw[0] ?? null : raw
}

async function readUploadBuffer(
  file: UploadedFile | null
): Promise<Buffer | null> {
  if (!file) return null
  if (file.buffer?.length) return file.buffer
  const filepath = file.filepath
  if (!filepath) return null
  try {
    const buffer = await fs.readFile(filepath)
    await fs.unlink(filepath).catch(() => undefined)
    return buffer
  } catch {
    return null
  }
}

function parsePositiveUserId(raw: unknown): number | null {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.trunc(n)
}

/** 资料卡高光图：登录即可；内存 → sharp → COS origin + compressed（同名，blog 约定） */
router.post(userClientApi('/profile/upload-image'), async (ctx) => {
  const userId = ctx.state.user?.id
  if (!userId) {
    response.error(ctx, HTTP_STATUS.UNAUTHORIZED, '身份凭证无效, 请重新登录')
    return
  }

  const file = pickSingleFile(ctx.request.files)
  const buffer = await readUploadBuffer(file)
  if (!buffer?.length) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '请选择要上传的图片')
    return
  }

  const cos = getCosUploadClient()
  const newFilename = cos
    .hashAndKeepOriginalName({
      originalFilename: file?.originalFilename ?? null
    })
    .replaceAll(/\s/g, '')

  try {
    const data = await cos.processOriginAndCompressedImageFromBuffer({
      buffer,
      originalFilename: file?.originalFilename ?? null,
      newFilename,
      size: file?.size ?? buffer.length
    })
    // data.url = compressed；data.originalUrl = origin。业务入库用 url 即可
    response.success(ctx, data, '上传成功')
  } catch (error) {
    logger.error(error)
    response.error(
      ctx,
      HTTP_STATUS.BAD_REQUEST,
      error instanceof Error ? error.message : '上传失败'
    )
  }
})

router.post(userClientApi('/profile/highlights'), async (ctx) => {
  const viewerId = ctx.state.user?.id
  if (!viewerId) {
    response.error(ctx, HTTP_STATUS.UNAUTHORIZED, '身份凭证无效, 请重新登录')
    return
  }
  const body = (ctx.request.body ?? {}) as { userId?: number }
  const targetUserId = parsePositiveUserId(body.userId) ?? viewerId
  const slots = await listProfileHighlights(targetUserId)
  response.success(ctx, { slots })
})

router.post(userClientApi('/profile/highlights/set'), async (ctx) => {
  const userId = ctx.state.user?.id
  if (!userId) {
    response.error(ctx, HTTP_STATUS.UNAUTHORIZED, '身份凭证无效, 请重新登录')
    return
  }
  const body = (ctx.request.body ?? {}) as {
    slotIndex?: number
    imageUrl?: string
  }
  const slotIndex = Number(body.slotIndex)
  const imageUrl = typeof body.imageUrl === 'string' ? body.imageUrl : ''
  const cos = getCosUploadClient()
  const result = await setProfileHighlight({
    userId,
    slotIndex,
    imageUrl,
    cosDomain: cos.cosDomain
  })
  if ('error' in result) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, result.error)
    return
  }
  response.success(ctx, { slots: result })
})

router.post(userClientApi('/profile/highlights/clear'), async (ctx) => {
  const userId = ctx.state.user?.id
  if (!userId) {
    response.error(ctx, HTTP_STATUS.UNAUTHORIZED, '身份凭证无效, 请重新登录')
    return
  }
  const body = (ctx.request.body ?? {}) as { slotIndex?: number }
  const slotIndex = Number(body.slotIndex)
  const result = await clearProfileHighlight({ userId, slotIndex })
  if ('error' in result) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, result.error)
    return
  }
  response.success(ctx, { slots: result })
})

router.post(userClientApi('/profile/guestbook'), async (ctx) => {
  const viewerId = ctx.state.user?.id
  if (!viewerId) {
    response.error(ctx, HTTP_STATUS.UNAUTHORIZED, '身份凭证无效, 请重新登录')
    return
  }
  const body = (ctx.request.body ?? {}) as { userId?: number; limit?: number }
  const wallUserId = parsePositiveUserId(body.userId) ?? viewerId
  const list = await listGuestbookMessages({
    wallUserId,
    limit: body.limit
  })
  response.success(ctx, { list, maxChars: PROFILE_GUESTBOOK_MAX_CHARS })
})

router.post(userClientApi('/profile/guestbook/create'), async (ctx) => {
  const authorUserId = ctx.state.user?.id
  if (!authorUserId) {
    response.error(ctx, HTTP_STATUS.UNAUTHORIZED, '身份凭证无效, 请重新登录')
    return
  }
  const body = (ctx.request.body ?? {}) as {
    userId?: number
    content?: string
  }
  const wallUserId = parsePositiveUserId(body.userId)
  if (!wallUserId) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '参数异常：需要 userId')
    return
  }
  const content = normalizeGuestbookContent(body.content)
  if (!content) {
    response.error(
      ctx,
      HTTP_STATUS.BAD_REQUEST,
      `留言需为 1～${PROFILE_GUESTBOOK_MAX_CHARS} 字`
    )
    return
  }
  const result = await createGuestbookMessage({
    wallUserId,
    authorUserId,
    content
  })
  if ('error' in result) {
    response.error(
      ctx,
      result.status === 404 ? HTTP_STATUS.NOT_FOUND : HTTP_STATUS.BAD_REQUEST,
      result.error
    )
    return
  }
  response.success(ctx, result, '留言成功')
})

router.post(userClientApi('/profile/guestbook/delete'), async (ctx) => {
  const actorUserId = ctx.state.user?.id
  if (!actorUserId) {
    response.error(ctx, HTTP_STATUS.UNAUTHORIZED, '身份凭证无效, 请重新登录')
    return
  }
  const body = (ctx.request.body ?? {}) as { id?: number }
  const messageId = Number(body.id)
  if (!Number.isInteger(messageId) || messageId <= 0) {
    response.error(ctx, HTTP_STATUS.BAD_REQUEST, '参数异常：需要 id')
    return
  }
  const result = await deleteGuestbookMessage({ messageId, actorUserId })
  if ('error' in result) {
    let status: number = HTTP_STATUS.BAD_REQUEST
    if (result.status === 403) status = HTTP_STATUS.FORBIDDEN
    else if (result.status === 404) status = HTTP_STATUS.NOT_FOUND
    response.error(ctx, status, result.error)
    return
  }
  response.success(ctx, null, '已删除')
})

router.post(userClientApi('/profile/guestbook/unreadCount'), async (ctx) => {
  const wallUserId = ctx.state.user?.id
  if (!wallUserId) {
    response.error(ctx, HTTP_STATUS.UNAUTHORIZED, '身份凭证无效, 请重新登录')
    return
  }
  const count = await getGuestbookUnreadCount(wallUserId)
  response.success(ctx, { count })
})

router.post(userClientApi('/profile/guestbook/markRead'), async (ctx) => {
  const wallUserId = ctx.state.user?.id
  if (!wallUserId) {
    response.error(ctx, HTTP_STATUS.UNAUTHORIZED, '身份凭证无效, 请重新登录')
    return
  }
  await markGuestbookWallRead(wallUserId)
  response.success(ctx, { ok: true })
})

/** 注册 / 换绑 Expo Push Token（留言等系统通知） */
router.post(userClientApi('/push/register'), async (ctx) => {
  const userId = ctx.state.user?.id
  if (!userId) {
    response.error(ctx, HTTP_STATUS.UNAUTHORIZED, '身份凭证无效, 请重新登录')
    return
  }
  const body = (ctx.request.body ?? {}) as {
    token?: unknown
    platform?: unknown
  }
  const token = typeof body.token === 'string' ? body.token.trim() : ''
  if (!isValidExpoPushToken(token)) {
    response.error(
      ctx,
      HTTP_STATUS.BAD_REQUEST,
      '参数异常：需要有效的 Expo Push Token'
    )
    return
  }
  await upsertUserPushToken({
    userId,
    token,
    platform: normalizePushPlatform(body.platform)
  })
  response.success(ctx, { ok: true }, '已注册推送')
})

router.post(userClientApi('/push/unregister'), async (ctx) => {
  const userId = ctx.state.user?.id
  if (!userId) {
    response.error(ctx, HTTP_STATUS.UNAUTHORIZED, '身份凭证无效, 请重新登录')
    return
  }
  const body = (ctx.request.body ?? {}) as { token?: unknown }
  const token = typeof body.token === 'string' ? body.token.trim() : ''
  if (!isValidExpoPushToken(token)) {
    response.error(
      ctx,
      HTTP_STATUS.BAD_REQUEST,
      '参数异常：需要有效的 Expo Push Token'
    )
    return
  }
  await removeUserPushToken({ userId, token })
  response.success(ctx, { ok: true }, '已取消推送')
})
