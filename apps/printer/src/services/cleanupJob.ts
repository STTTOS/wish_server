import { PRINT_FILE_RETENTION_DAYS } from '../config'
import { logger } from '../logger'
import { getCosUploadClient } from './cosUpload'
import { printFileRepository } from '../repositories/printFileRepository'

const HOUR_MS = 60 * 60 * 1000

async function deleteCosKeysBestEffort(
  items: { id: string; cosKey: string }[]
): Promise<string[]> {
  if (items.length === 0) return []

  const keys = items.map((item) => item.cosKey)
  try {
    await getCosUploadClient().deleteMultipleObjects(keys)
    return items.map((item) => item.id)
  } catch (error) {
    logger.error(
      '[cleanup] COS batch delete failed, falling back to per-object',
      error
    )
  }

  const cos = getCosUploadClient()
  const succeeded: string[] = []
  for (const item of items) {
    try {
      await cos.deleteObject(item.cosKey)
      succeeded.push(item.id)
    } catch (error) {
      logger.error(`[cleanup] COS delete failed key=${item.cosKey}`, error)
    }
  }
  return succeeded
}

export async function cleanupExpiredPrintFiles() {
  const before = new Date(
    Date.now() - PRINT_FILE_RETENTION_DAYS * 24 * HOUR_MS
  )
  const batch = await printFileRepository.listExpiredForCleanup(before, 1000)
  if (batch.length === 0) {
    logger.info('[cleanup] no expired print files pending COS purge')
    return
  }

  const purgedIds = await deleteCosKeysBestEffort(batch)
  if (purgedIds.length > 0) {
    await printFileRepository.markCosPurged(purgedIds)
  }

  const failed = batch.length - purgedIds.length
  if (failed > 0) {
    logger.warn(
      `[cleanup] purged ${purgedIds.length}/${batch.length}; ${failed} left for retry`
    )
  } else {
    logger.info(`[cleanup] purged ${purgedIds.length} print files from COS`)
  }
}

export function startPrintFileCleanupCron() {
  const run = () => {
    cleanupExpiredPrintFiles().catch((error) => {
      logger.error('[cleanup] job failed', error)
    })
  }
  // 启动后稍晚跑一次，之后每小时
  setTimeout(run, 15_000)
  setInterval(run, HOUR_MS)
  logger.info(
    `[cleanup] scheduled every 1h, retention=${PRINT_FILE_RETENTION_DAYS}d`
  )
}
