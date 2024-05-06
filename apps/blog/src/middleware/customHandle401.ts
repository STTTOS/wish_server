import { Context } from 'koa'

import response from '../utils/response'

const customHandle401 = async (ctx: Context, next: () => Promise<void>) => {
  try {
    await next()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    if (err.status === 401) {
      response.success(ctx, null, '身份凭证无效, 请重新登陆', 401)
    } else {
      throw err
    }
  }
}
export default customHandle401
