import type { StartGameValidatedContext } from './types'

import { logger } from '../../../logger'
import { GameWsGateway } from './gameWsGateway'
import { room as roomModel } from '../../../models'
import { gameRuntimeRegistry } from './runtimeRegistry'
import { createMatchRollbackManager } from './rollback'
import { bindTexasLifecycleEvents } from './eventBinder'
import { transitionRoomGameStatus } from './stateMachine'
import {
  validateStartGameRequest,
  markRoomEnteringAndNotify
} from './validator'
import {
  createTexasAndSeatPlayers,
  createInitialMatchAndNotifyEntered
} from './runtime'

/**
 * 统一入口：开始游戏用例，路由层只调用该类。
 */
export class StartGameUseCase {
  constructor(private readonly wsGateway = new GameWsGateway()) {}

  async requestStart(roomId: number, ownerId: number) {
    const validated = await validateStartGameRequest(roomId, ownerId)
    if (!validated.ok) return validated

    const { members } = validated.data
    const userIds = members.map((m) => m.userId)
    await transitionRoomGameStatus(roomId, 'entering')
    await markRoomEnteringAndNotify(roomId, userIds, this.wsGateway)

    return {
      ok: true as const,
      data: {
        roomId,
        ownerId,
        roomInfo: validated.data.roomInfo,
        members,
        roomKey: String(roomId),
        userIds
      }
    }
  }

  runStartFlowInBackground(input: {
    roomId: number
    ownerId: number
    roomInfo: StartGameValidatedContext['roomInfo']
    members: StartGameValidatedContext['members']
    roomKey: string
    userIds: number[]
  }) {
    void this.#runStartFlow(input)
  }

  async #runStartFlow(input: {
    roomId: number
    ownerId: number
    roomInfo: StartGameValidatedContext['roomInfo']
    members: StartGameValidatedContext['members']
    roomKey: string
    userIds: number[]
  }) {
    const { roomId, ownerId, roomInfo, members, roomKey, userIds } = input
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

    try {
      await this.wsGateway.waitForAllGameConnections(roomKey, userIds)
      this.wsGateway.untrackEntering(roomId)

      const texas = createTexasAndSeatPlayers({ roomInfo, members, ownerId })
      await delay(3000)
      const matchInfo = await createInitialMatchAndNotifyEntered({
        roomId,
        roomInfo,
        wsGateway: this.wsGateway
      })
      const currentMatchId = matchInfo.id

      const rollbackManager = createMatchRollbackManager({
        texas,
        roomId,
        roomKey,
        runtimeRegistry: gameRuntimeRegistry,
        wsGateway: this.wsGateway
      })
      rollbackManager.snapshotPlayersAtHandStart(currentMatchId)
      gameRuntimeRegistry.register({
        roomId,
        roomKey,
        texas,
        currentMatchId,
        matchStartedAt: Date.now(),
        rollbackManager
      })

      bindTexasLifecycleEvents({
        texas,
        roomId,
        roomKey,
        roomInfo,
        runtimeRegistry: gameRuntimeRegistry,
        wsGateway: this.wsGateway
      })

      texas.resetBeforeGameStart()
      texas.setPlayerRoles()
      await delay(2000)
      texas.dealCards()
      await delay(2000)
      gameRuntimeRegistry
        .getOrThrow(roomKey)
        .rollbackManager.snapshotPlayersAtHandStart(
          gameRuntimeRegistry.getOrThrow(roomKey).currentMatchId
        )
      await texas.controller.start()

      await roomModel.update({
        where: { id: roomId },
        data: { gameStatus: 'in_hand' }
      })
    } catch (e: unknown) {
      gameRuntimeRegistry.destroyRuntime(roomKey)
      this.wsGateway.untrackEntering(roomId)
      await roomModel.update({
        where: { id: roomId },
        data: { gameStatus: 'waiting' }
      })
      const reason = e instanceof Error ? e.message : '进入游戏失败'
      this.wsGateway.notifyEnteringFailed(roomId, reason)
      logger.error('[entring] start game flow failed', e)
    }
  }
}
