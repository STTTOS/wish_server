/* eslint-disable camelcase */
import { SHA1 } from 'crypto-js'

import { logger } from '@/logger'
import router from '../../instance'
import response from '@/utils/response'
import { apiPrefix } from '../../../config'
import combinePath from '../../../utils/combinePath'

const tencentJSApi = combinePath(apiPrefix)('/jsSDK/tencent')

interface TencentJSApiRes {
  // 不为 0 则表示出错
  errcode: number
  errmsg: string
}
interface AccessTokenRes extends TencentJSApiRes {
  access_token: string
  // 单位: s, 7200s左右,
  expires_in: number
}
async function getAccessToken() {
  const res = await fetch(
    `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=wxd696395b3b2bf287&secret=${process.env.TENCENT_JS_API_SECRET}`
  )
  const data = (await res.json()) as AccessTokenRes

  if (data.errcode && data.errcode !== 0) {
    throw new Error(data.errmsg)
  }

  logger.info(
    `获取到tencent js api access_token: ${data.access_token.slice(0, 8)}****`
  )
  return data
}
async function getTicket(accessToken: string) {
  const res = await fetch(
    `https://api.weixin.qq.com/cgi-bin/ticket/getticket?access_token=${accessToken}&type=jsapi`
  )
  const data = (await res.json()) as {
    expires_in: number
    ticket: string
  } & TencentJSApiRes

  if (data.errcode && data.errcode !== 0) {
    throw new Error(data.errmsg)
  }

  logger.info(`获取到tencent js api ticket: ${data.ticket.slice(0, 8)}****`)
  return data
}
function genSignature(jsapi_ticket: string, url: string) {
  const timestamp = Date.now()
  const noncestr = Math.random().toString(36).slice(-8)
  const input = `jsapi_ticket=${jsapi_ticket}&timestamp=${timestamp}&noncestr=${noncestr}&url=${url}`

  return {
    signature: SHA1(input).toString(),
    timestamp,
    noncestr
  }
}

/**
 * noncestr=Wm3WZYTPz0wzccnW
jsapi_ticket=sM4AOVdWfPE4DxkXGEs8VMCPGGVi4C3VM0P37wVUCFvkVAy_90u5h9nbSlYy3-Sl-HhTdfl2fzFy1AOcHKP7qg
timestamp=1414587457
url=http://mp.weixin.qq.com?params=value
 */
const cache: { ticket?: string; lastGetTime?: number; expires: number } = {
  expires: 0
}
router.post(tencentJSApi('/getSignature'), async (ctx) => {
  // 判断accessToken是否有效
  if (
    !cache?.lastGetTime ||
    Math.abs(Date.now() - cache.lastGetTime) >= cache.expires * 1000
  ) {
    logger.info('新获取accessToken以及signature')

    const lastGetTime = Date.now()
    const { access_token } = await getAccessToken()

    // !attention  需要全局缓存`ticket`, 有效期以返回的`expires_in`为准, 频繁调用会导致接口失效
    const { ticket, expires_in } = await getTicket(access_token)

    cache.ticket = ticket
    cache.lastGetTime = lastGetTime
    cache.expires = expires_in

    const data = genSignature(ticket, ctx.header.referer!)
    response.success(ctx, data)
    return
  }

  logger.info('signature未失效, 使用缓存')
  const data = genSignature(cache.ticket!, ctx.header.referer!)
  response.success(ctx, data)
})
