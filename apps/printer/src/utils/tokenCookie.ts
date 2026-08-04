import type { Context } from 'koa'

import { tokenValidatedTime } from '../config'

/** Cookie 会话：登录态 token 读写 */
export const tokenCookie = {
  set(ctx: Context, token: string) {
    ctx.cookies.set('token', token, {
      httpOnly: true,
      maxAge: tokenValidatedTime * 1000
    })
  },

  clear(ctx: Context) {
    ctx.cookies.set('token', null)
  }
}
