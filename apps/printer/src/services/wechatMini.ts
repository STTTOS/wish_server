/**
 * 微信小程序 code2session。
 * @see https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/user-login/code2Session.html
 */

export type WechatSession = {
  openid: string
  sessionKey: string
  unionid?: string
}

type Code2SessionResponse = {
  openid?: string
  session_key?: string
  unionid?: string
  errcode?: number
  errmsg?: string
}

export function getWechatMiniCredentials() {
  const appId = (process.env.WECHAT_MINI_APPID || '').trim()
  const secret = (process.env.WECHAT_MINI_SECRET || '').trim()
  if (!appId || !secret) return null
  return { appId, secret }
}

export function isWechatMiniConfigured() {
  return getWechatMiniCredentials() != null
}

export async function code2Session(code: string): Promise<WechatSession> {
  const creds = getWechatMiniCredentials()
  if (!creds) {
    throw Object.assign(new Error('服务未配置微信小程序凭证'), { status: 503 })
  }

  const trimmed = code.trim()
  if (!trimmed) {
    throw Object.assign(new Error('code 不能为空'), { status: 400 })
  }

  const url = new URL('https://api.weixin.qq.com/sns/jscode2session')
  url.searchParams.set('appid', creds.appId)
  url.searchParams.set('secret', creds.secret)
  url.searchParams.set('js_code', trimmed)
  url.searchParams.set('grant_type', 'authorization_code')

  const res = await fetch(url)
  if (!res.ok) {
    throw Object.assign(new Error('微信登录服务暂不可用'), { status: 502 })
  }

  const data = (await res.json()) as Code2SessionResponse
  if (data.errcode && data.errcode !== 0) {
    const message =
      data.errcode === 40029
        ? '登录凭证无效，请重试'
        : data.errcode === 45011
          ? '登录过于频繁，请稍后再试'
          : data.errmsg || '微信登录失败'
    throw Object.assign(new Error(message), { status: 401 })
  }

  if (!data.openid || !data.session_key) {
    throw Object.assign(new Error('微信登录失败'), { status: 401 })
  }

  return {
    openid: data.openid,
    sessionKey: data.session_key,
    unionid: data.unionid
  }
}
