/**
 * 初始化默认数据：
 * - 品类「未分类」
 * - 管理员 admin / yuanfang
 * - 店员 staff / yuangong（店员密码未指定，可按需修改）
 *
 * 用法：pnpm --filter @wishufree/mart-server db:seed
 */
import type { Role } from '@prisma/mart-client'

import { logger } from '../logger'
import { hashPassword } from '../utils/password'
import { userRepository } from '../repositories/userRepository'
import { ensureDefaultCategory } from '../services/ensureDefaultCategory'

const SEED_USERS: Array<{
  username: string
  password: string
  role: Role
}> = [
  { username: 'admin', password: 'yuanfang', role: 'admin' },
  { username: 'staff', password: 'yuangong', role: 'staff' }
]

async function main() {
  await ensureDefaultCategory()
  for (const item of SEED_USERS) {
    await userRepository.upsertSeed({
      username: item.username,
      password: hashPassword(item.password),
      role: item.role
    })
    logger.info(`[seed] upserted user: ${item.username}`)
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
