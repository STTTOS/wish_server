import type { Context } from 'koa'

export function withList(list: unknown[], total: number) {
  return { total, list }
}
export function success(
  ctx: Context,
  data: unknown = null,
  msg = '成功',
  code = 200
) {
  ctx.body = {
    msg,
    data,
    code
  }
}
export function error(ctx: Context, code: number, msg: string) {
  ctx.body = {
    msg,
    code,
    data: null
  }
}
// 统一封装response响应
const response = {
  error,
  success
}
export default response
