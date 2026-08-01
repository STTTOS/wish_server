import router from '../instance'
import { apiPrefix } from '../../config'
import response from '../../utils/response'
import combinePath from '../../utils/combinePath'
import { loginFacade } from './services/loginFacade'
import { tokenCookie } from '../../utils/tokenCookie'
import { HTTP_STATUS } from '../../constants/httpStatus'
import { respondFromApiResult } from '../../utils/respondFromApiResult'

const authApi = combinePath(apiPrefix)('/auth')

router.post(authApi('/login'), async (ctx) => {
  const body = (ctx.request.body || {}) as {
    username?: unknown
    password?: unknown
  }
  const result = await loginFacade({
    username: body.username,
    password: body.password
  })
  if (result.ok) {
    tokenCookie.set(ctx, result.data.token)
  }
  respondFromApiResult(ctx, result, { okMessage: '登录成功' })
})

router.post(authApi('/logout'), async (ctx) => {
  tokenCookie.clear(ctx)
  response.success(ctx, null, '已退出登录')
})

router.get(authApi('/me'), async (ctx) => {
  const current = ctx.state.user
  if (!current) {
    response.error(ctx, HTTP_STATUS.UNAUTHORIZED, '身份凭证无效, 请重新登陆')
    return
  }
  response.success(ctx, {
    id: current.id,
    username: current.username,
    role: current.role
  })
})
