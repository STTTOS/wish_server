import { join } from 'path'
import { rm } from 'fs/promises'

import router from '../instance'
import { apiPrefix } from '../../config'
import response from '../../utils/response'
import combinePath from '../../utils/combinePath'
import getOriginFileMeta, { getAllFiles } from '../../utils/file'

const storageApi = combinePath(apiPrefix)('/storage')

router.post(storageApi('/persistent/list'), async (ctx) => {
  const filenames = await getAllFiles(
    join(__dirname, '../../../static/files'),
    {
      onlyFileName: true
    }
  )
  response.success(ctx, {
    list: filenames.map((name) => ({
      name: getOriginFileMeta(name).name,
      url: `/static/files/${name}`
    }))
  })
})

router.post(storageApi('/temp/list'), async (ctx) => {
  const filenames = await getAllFiles(join(__dirname, '../../../static/temp'), {
    onlyFileName: true
  })

  response.success(ctx, {
    list: filenames.map((name) => ({
      name: getOriginFileMeta(name).name,
      url: `/static/temp/${name}`
    }))
  })
})

router.post(storageApi('/persistent/delete'), async (ctx) => {
  const { id } = ctx.request.body
  await rm(join(__dirname, '../../../static/files', id))
  response.success(ctx)
})
