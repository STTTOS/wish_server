import { logger } from '../logger'

export type AppClientFlagsSnapshot = {
  /** App 主页是否展示积分榜；默认 true */
  showHomeScoreLeaders: boolean
}

export type AppClientFlagsPatch = {
  showHomeScoreLeaders?: unknown
}

/**
 * App 客户端展示开关（进程内单例）。
 * 与游戏延时运行时配置分开，避免布尔展示项混入毫秒字段。
 */
export class AppClientFlagsStore {
  #showHomeScoreLeaders = true

  getShowHomeScoreLeaders(): boolean {
    return this.#showHomeScoreLeaders
  }

  getSnapshot(): AppClientFlagsSnapshot {
    return {
      showHomeScoreLeaders: this.#showHomeScoreLeaders
    }
  }

  applyPatch(
    input: AppClientFlagsPatch
  ):
    | { ok: true; data: AppClientFlagsSnapshot }
    | { ok: false; message: string } {
    const keys = Object.keys(input).filter(
      (k) => input[k as keyof AppClientFlagsPatch] !== undefined
    )
    if (keys.length === 0) {
      return { ok: false, message: '至少需要一个配置字段' }
    }

    if (input.showHomeScoreLeaders !== undefined) {
      if (typeof input.showHomeScoreLeaders !== 'boolean') {
        return { ok: false, message: 'showHomeScoreLeaders 须为布尔值' }
      }
      this.#showHomeScoreLeaders = input.showHomeScoreLeaders
    }

    const data = this.getSnapshot()
    logger.info(`[appClientFlags] updated ${JSON.stringify(data)}`)
    return { ok: true, data }
  }
}

export const appClientFlags = new AppClientFlagsStore()
