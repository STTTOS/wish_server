import { logger } from '../logger'
import { DEFAULT_CATEGORY_NAME } from '../config'
import { categoryRepository } from '../repositories/categoryRepository'

/** 保证系统默认品类「未分类」存在（启动时幂等） */
export async function ensureDefaultCategory() {
  const record = await categoryRepository.ensureByName(DEFAULT_CATEGORY_NAME)
  logger.info(`[bootstrap] ensured default category: ${DEFAULT_CATEGORY_NAME}`)
  return record
}

export async function getDefaultCategoryId() {
  const record = await ensureDefaultCategory()
  return record.id
}
