import Cookie from 'cookie'
import { Context } from 'koa'
import jwt from 'jsonwebtoken'
import { toLower } from 'ramda'

import { user } from '../models'

export interface AuthenticateMiddlewareProps {
  secret: string
  include?: '*' | string[]
}
function parseJwt(token: string, scret: string) {
  try {
    const decoded = jwt.verify(token, scret) as unknown as {
      id: number
      role: string
    }
    return { error: null, data: decoded }
  } catch (error) {
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      error: (error as any).name as 'TokenExpiredError',
      data: null
    }
  }
}
async function getUserInfo(id?: number) {
  try {
    if (!id) return null
    return user.findUnique({ where: { id } })
  } catch (error) {
    return null
  }
}
const authenticateMiddleware =
  ({ secret, include = '*' }: AuthenticateMiddlewareProps) =>
  async (ctx: Context, next: () => Promise<void>) => {
    if (
      include == '*' ||
      include.some((url) => toLower(url) === toLower(ctx.request.url))
    ) {
      const { token } = Cookie.parse(ctx.request.headers.cookie || '')
      const { data, error } = parseJwt(token, secret)

      const userData = await getUserInfo(data?.id)
      const tokenStatus = (() => {
        if (data) return 'valid'

        if (error === 'TokenExpiredError') return 'expire'
        return 'invalid'
      })()

      ctx.userInfo = {
        id: userData?.id as number,
        data: userData,
        tokenStatus
      }
      await next()
    } else {
      await next()
    }
  }
export default authenticateMiddleware
