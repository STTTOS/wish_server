import { match } from '../../../models'
import { gameRuntimeRegistry } from './runtimeRegistry'

/**
 * 优先使用内存 runtime 的 currentMatchId，缺失时再回退数据库。
 */
export async function getCurrentMatchIdWithFallback(roomId: number) {
  const runtimeMatchId = gameRuntimeRegistry.getCurrentMatchId(String(roomId))
  if (runtimeMatchId != null) return runtimeMatchId

  const latestMatch = await match.findFirst({
    where: { roomId, endedAt: null },
    select: { id: true },
    orderBy: [{ startedAt: 'desc' }, { id: 'desc' }]
  })
  return latestMatch?.id ?? null
}
