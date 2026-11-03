import { STYLE_SCOPE_ALL } from './engine'
import { user, userSettings } from '../models'
import { getUserStyleRadar, type UserStyleRadarDto } from './getRadar'
import { getPlayerHonors, type PlayerHonorsDto } from './playerHonors'

export type PlayerCardDto = {
  userId: number
  name: string
  username: string
  avatarUrl: string | null
  avatarKey: string
  honors: PlayerHonorsDto
  /**
   * 是否对当前查看者开放雷达内容。
   * 本人恒为 true；他人取决于目标 showStyleRadar。
   */
  styleRadarVisible: boolean
  /** 未开放时为 null（不返回轴/标签，避免泄漏） */
  styleRadar: UserStyleRadarDto | null
}

const canViewStyleRadar = async (
  viewerUserId: number,
  targetUserId: number
): Promise<boolean> => {
  if (viewerUserId === targetUserId) return true
  const settings = await userSettings.findUnique({
    where: { userId: targetUserId },
    select: { showStyleRadar: true }
  })
  return settings?.showStyleRadar === true
}

/**
 * 桌内点头像 / 个人主页复用的玩家名片。
 * 荣誉与手数始终返回；雷达受 showStyleRadar 控制。
 */
export const getPlayerCard = async (
  viewerUserId: number,
  targetUserId: number,
  scope: string = STYLE_SCOPE_ALL
): Promise<PlayerCardDto | null> => {
  const profile = await user.findUnique({
    where: { id: targetUserId },
    select: {
      id: true,
      name: true,
      username: true,
      avatarUrl: true,
      avatarKey: true,
      deletedAt: true
    }
  })
  if (!profile || profile.deletedAt != null) return null

  const [honors, styleRadarVisible] = await Promise.all([
    getPlayerHonors(targetUserId),
    canViewStyleRadar(viewerUserId, targetUserId)
  ])

  let styleRadar: UserStyleRadarDto | null = null
  if (styleRadarVisible) {
    styleRadar = await getUserStyleRadar(targetUserId, scope)
  }

  return {
    userId: profile.id,
    name: profile.name,
    username: profile.username,
    avatarUrl: profile.avatarUrl,
    avatarKey: profile.avatarKey,
    honors,
    styleRadarVisible,
    styleRadar
  }
}
