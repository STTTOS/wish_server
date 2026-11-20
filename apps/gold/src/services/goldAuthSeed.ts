import prisma from '../models'
import { hashPassword } from '../utils/password'
import { logger } from '../logger'

/**
 * 首次部署：在 .env 配置 GOLD_SEED_USERNAME / GOLD_SEED_PASSWORD 创建唯一用户。
 * 密码仅存哈希，勿把明文写入仓库。
 */
export async function ensureGoldSeedUser() {
  const username = (process.env.GOLD_SEED_USERNAME || 'xuanJing').trim()
  const password = (process.env.GOLD_SEED_PASSWORD || '').trim()
  if (!username || !password) return

  const existing = await prisma.goldUser.findUnique({ where: { username } })
  if (existing) return

  await prisma.goldUser.create({
    data: {
      username,
      passwordHash: hashPassword(password)
    }
  })
  logger.info('gold auth seed', `created user ${username}`)
}
