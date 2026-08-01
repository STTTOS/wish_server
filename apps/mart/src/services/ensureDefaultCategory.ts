import { logger } from '../logger'
import { category } from '../models'
import { DEFAULT_CATEGORY_NAME } from '../config'

/** 保证系统默认品类「未分类」存在（启动时幂等） */
export async function ensureDefaultCategory() {
  const existing = await category.findFirst({
    where: { name: DEFAULT_CATEGORY_NAME, deletedAt: null }
  })
  if (existing) return existing

  const created = await category.create({
    data: { name: DEFAULT_CATEGORY_NAME }
  })
  logger.info(`[bootstrap] created default category: ${DEFAULT_CATEGORY_NAME}`)
  return created
}

export async function getDefaultCategoryId() {
  const record = await ensureDefaultCategory()
  return record.id
}
