import router from '../instance'
import { message } from '../../models'
import response from '@/utils/response'
import { apiPrefix } from '../../config'
import combinePath from '../../utils/combinePath'

const systemApi = combinePath(apiPrefix)('/system')

router.post(systemApi('/sendNotify'), async (ctx) => {
  const { link, content } = ctx.request.body

  await message.create({
    data: {
      type: 'system',
      content,
      extra: {
        link
      }
    }
  })
  response.success(ctx)
})
