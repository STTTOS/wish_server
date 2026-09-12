import prisma from '../models'
import router from './instance'
import { apiPrefix } from '../config'
import response from '../utils/response'
import combinePath from '../utils/combinePath'

const healthApi = combinePath(apiPrefix)('')

router.get(healthApi('/health'), async (ctx) => {
  const count = await prisma.roadSign.count()
  response.success(ctx, {
    service: 'roadsign',
    signCount: count
  })
})
