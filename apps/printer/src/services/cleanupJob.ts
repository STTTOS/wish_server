import { PRINT_FILE_RETENTION_DAYS } from '../config'
import { logger } from '../logger'
import { getCosUploadClient } from './cosUpload'
import { printFileRepository } from '../repositories/printFileRepository'

const HOUR_MS = 60 * 60 * 1000

export async function cleanupExpiredPrintFiles() {
  const before = new Date(
    Date.now() - PRINT_FILE_RETENTION_DAYS * 24 * HOUR_MS
  )
  const batch = await printFileRepository.listExpiredForCleanup(before, 1000)
  if (batch.length === 0) {
    logger.info('[cleanup] no expired print files')
    return
  }

  const keys = batch.map((item) => item.cosKey).filter(Boolean)
  try {
    await getCosUploadClient().deleteMultipleObjects(keys)
  } catch (error) {
    logger.error('[cleanup] COS delete failed', error)
    // still soft-delete DB so we do not retry forever on stuck keys;
    // lifecycle rule is the backup for orphan objects
  }

  await printFileRepository.softDeleteMany(batch.map((item) => item.id))
  logger.info(`[cleanup] soft-deleted ${batch.length} print files`)
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
