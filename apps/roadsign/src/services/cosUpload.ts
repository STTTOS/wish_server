import { join } from 'path'
import { createCosUploadClient } from '@wishufree/cos-upload'

import { logger } from '../logger'

let client: ReturnType<typeof createCosUploadClient> | null = null

export function getCosUploadClient() {
  if (client) return client

  client = createCosUploadClient({
    secretId: process.env.COS_SECRET_ID || '',
    secretKey: process.env.COS_SECRET_KEY || '',
    staticDir: join(__dirname, '../../static'),
    logger: {
      info: (...args) => {
        logger.info(args[0], ...args.slice(1))
      },
      warn: (...args) => {
        logger.warn(args[0], ...args.slice(1))
      },
      error: (...args) => {
        logger.error(args[0], ...args.slice(1))
      }
    }
  })
  return client
}
