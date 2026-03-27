import { user } from '../models'
import { logger } from '../logger'

export const isAdminUser = async (userId?: number | null) => {
  if (!userId) return false
  try {
    const target = await user.findUnique({
      where: { id: userId },
      select: { isAdmin: true }
    })
    return !!target?.isAdmin
  } catch (error) {
    logger.error('query admin user failed', error)
    return false
  }
}
