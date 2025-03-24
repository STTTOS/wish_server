import dayjs from 'dayjs'
import { v4 as uuidv4 } from 'uuid'
import { Prisma } from '@prisma/texas-client'

import router from '../instance'
import { user } from '../../models'
import response from '../../utils/response'
import { getToken } from '../../utils/login'
import combinePath from '../../utils/combinePath'
import { apiPrefix, timeFormat } from '../../config'

const userApi = combinePath(apiPrefix)('/user')
export const loginUsers = new Map<number, { sessionId: string; time: string }>()

/**
 * 用户登录接口
 * 目前测试只用输入昵称即可
 * 正式版本需要调用weChat实现登录注册
 */
router.post(userApi('/sign'), async (ctx) => {
  const { name }: { name: Prisma.UserCreateInput['name'] } = ctx.request.body
  if (!name) {
    response.error(ctx, 400, '参数异常')
    return
  }
  const sessionId = uuidv4()
  const time = dayjs().format(timeFormat)
  const target = await user.findFirst({ where: { name } })

  // 存在账户, 直接登录
  if (target) {
    loginUsers.set(target.id!, { sessionId, time })
    response.success(
      ctx,
      { token: getToken({ sessionId, id: target.id }) },
      '登录成功'
    )
    // 注册
  } else {
    const target = await user.create({
      data: {
        name,
        balance: 20_000,
        avatar:
          'www.wishufree.com/static/files/download__2ea40fda-d3d0-4504-809c-996b2cb13ec0.jpeg'
      }
    })
    loginUsers.set(target.id!, { sessionId, time })
    response.success(
      ctx,
      { token: getToken({ sessionId, id: target.id }) },
      '注册成功'
    )
  }
})

router.post(userApi('/loginCheck'), async (ctx) => {
  const userId = ctx.state.user?.id

  if (!userId) {
    response.error(ctx, 401, '用户未登录')
  } else {
    const userInfo = await user.findUnique({
      where: {
        id: userId
      }
    })
    if (userInfo) {
      response.error(ctx, 2000, '用户不存在')
    } else {
      response.success(ctx, userInfo)
    }
  }
})
