import router from '../instance'
import { apiPrefix } from '../../config'
import response from '../../utils/response'
import combinePath from '../../utils/combinePath'

const toolsApi = combinePath(apiPrefix)('/test')

router.post(toolsApi('/test'), async (ctx) => {
  response.success(ctx)
})
