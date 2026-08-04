/**
 * seed：店员账号 printer / printer123，shopCode=default
 * 用法：pnpm --filter @wishufree/printer-server db:seed
 */
import { logger } from '../logger'
import { hashPassword } from '../utils/password'
import { userRepository } from '../repositories/userRepository'

const SEED_USERS = [
  {
    username: 'printer',
    password: 'printer123',
    shopCode: 'default'
  }
]

async function main() {
  for (const item of SEED_USERS) {
    await userRepository.upsertSeed({
      username: item.username,
      password: hashPassword(item.password),
      shopCode: item.shopCode
    })
    logger.info(`[seed] upserted user: ${item.username} shop=${item.shopCode}`)
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
