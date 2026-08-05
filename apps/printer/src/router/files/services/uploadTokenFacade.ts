import { userRepository } from '../../../repositories/userRepository'
import { code2Session, isWechatMiniConfigured } from '../../../services/wechatMini'
import { issueUploadToken } from '../../../utils/uploadToken'

const SHOP_CODE_RE = /^[a-zA-Z0-9_-]{1,64}$/

export async function issuePublicUploadToken(input: {
  code: unknown
  shopCode: unknown
}) {
  if (!isWechatMiniConfigured()) {
    throw Object.assign(new Error('服务未配置微信小程序凭证'), { status: 503 })
  }

  const code = typeof input.code === 'string' ? input.code.trim() : ''
  if (!code) {
    throw Object.assign(new Error('code 不能为空'), { status: 400 })
  }

  const shopCode =
    typeof input.shopCode === 'string' ? input.shopCode.trim() : ''
  if (!shopCode) {
    throw Object.assign(new Error('shopCode 不能为空'), { status: 400 })
  }
  if (!SHOP_CODE_RE.test(shopCode)) {
    throw Object.assign(new Error('shopCode 非法'), { status: 400 })
  }
  if (!(await userRepository.existsByShopCode(shopCode))) {
    throw Object.assign(new Error('店铺不存在或未开通'), { status: 403 })
  }

  const session = await code2Session(code)
  const issued = issueUploadToken({
    openid: session.openid,
    shopCode
  })

  return {
    token: issued.token,
    expiresIn: issued.expiresIn,
    shopCode
  }
}
