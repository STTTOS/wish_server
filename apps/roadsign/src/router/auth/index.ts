import router from '../instance'
import { apiPrefix } from '../../config'
import response from '../../utils/response'
import combinePath from '../../utils/combinePath'
import { HTTP_STATUS } from '../../constants/httpStatus'
import {
  signAdminToken,
  validateAdminCredentials
} from '../../services/authToken'

const authApi = combinePath(apiPrefix)('/auth')

router.post(authApi('/login'), async (ctx) => {
  const body = (ctx.request.body || {}) as {
    username?: unknown
    password?: unknown
  }
  if (!validateAdminCredentials(body.username, body.password)) {
    response.error(ctx, HTTP_STATUS.UNAUTHORIZED, '用户名或密码错误')
    return
  }
  const username =
    typeof body.username === 'string' ? body.username.trim() : 'admin'
  const token = signAdminToken(username)
  response.success(
    ctx,
    {
      token,
      user: { username, role: 'admin' as const }
    },
    '登录成功'
  )
})

router.post(authApi('/logout'), async (ctx) => {
  response.success(ctx, null, '已退出登录')
})

router.get(authApi('/me'), async (ctx) => {
  const user = ctx.state.user
  if (!user || !ctx.state.isAdmin) {
    response.success(ctx, { user: null }, '未登录')
    return
  }
  response.success(ctx, { user }, '成功')
})
