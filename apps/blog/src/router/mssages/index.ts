import moment from 'moment'

import router from '../instance'
import { message } from '../../models'
import combinePath from '../../utils/combinePath'
import { apiPrefix, timeFormat } from '../../config'
import response, { withList } from '../../utils/response'

const messageApi = combinePath(apiPrefix)('/message')

router.post(messageApi('/list'), async (ctx) => {
  const { current: skip, pageSize: take } = ctx.request.body

  const list = await message.findMany({
    take,
    skip: (skip - 1) * take
  })
  const total = await message.count()
  response.success(ctx, withList(list, total))
})

// router.post(messageApi('/add'), async (ctx) => {
//   const { senderId, receiverId, articleId, type, content } = ctx.request.body

//   if (!type || !content) throw new Error('参数不正确')

//   await message.create({
//     data: {
//       type,
//       content,
//       senderId,
//       receiverId,
//       articleId
//     }
//   })
//   response.success(ctx)
// })

router.post(messageApi('/read'), async (ctx) => {
  const { id } = ctx.request.body

  if (!id) throw new Error('参数异常')

  const data = await message.findUnique({
    where: { id }
  })
  // 需要验证这条消息的归属是否为本人
  if (data?.receiverId && data.receiverId === ctx.state.user.id)
    await message.update({
      where: {
        id
      },
      data: {
        isRead: true
      }
    })
  response.success(ctx)
})

router.post(messageApi('/unread'), async (ctx) => {
  const user = ctx.state.user

  const total = await message.count({
    where: { receiverId: user.id, isRead: false }
  })
  const list = await message.findMany({
    where: { receiverId: user.id, isRead: false },
    // 默认查询20条未读消息
    take: 20,
    include: {
      sender: {
        select: {
          name: true,
          avatar: true
        }
      }
    }
  })
  response.success(
    ctx,
    withList(
      list.map(({ createdAt, ...rest }) => ({
        createdAt: moment(createdAt).format(timeFormat),
        ...rest
      })),
      total
    )
  )
})
