/**
 * 初始化默认数据：
 * - 品类「未分类」
 * - 管理员 admin / yuanfang
 * - 店员 staff / yuangong（店员密码未指定，可按需修改）
 *
 * 用法：pnpm --filter @wishufree/mart-server db:seed
 */
import { Role } from '@prisma/mart-client'

import { user } from '../models'
import { logger } from '../logger'
import { hashPassword } from '../utils/password'
import { ensureDefaultCategory } from '../services/ensureDefaultCategory'

const SEED_USERS: Array<{
  username: string
  password: string
  role: Role
}> = [
  { username: 'admin', password: 'yuanfang', role: 'admin' },
  { username: 'staff', password: 'yuangong', role: 'staff' }
]

async function upsertUser(item: (typeof SEED_USERS)[number]) {
  const existing = await user.findUnique({ where: { username: item.username } })
  const password = hashPassword(item.password)
  if (existing) {
    await user.update({
      where: { id: existing.id },
      data: { password, role: item.role }
    })
    logger.info(`[seed] updated user: ${item.username}`)
    return
  }
  await user.create({
    data: {
      username: item.username,
      password,
      role: item.role
    }
  })
  logger.info(`[seed] created user: ${item.username}`)
}

async function main() {
  await ensureDefaultCategory()
  for (const item of SEED_USERS) {
    await upsertUser(item)
  }
  logger.info('[seed] done')
}

main()
  .catch((error) => {
    logger.error(error)
    process.exit(1)
  })
  .finally(async () => {
    const { default: prisma } = await import('../models')
    await prisma.$disconnect()
  })
