import type { StrategyProvider } from './types'

import { rulesP0StrategyProvider } from './rulesP0Provider'

export type {
  StrategyProvider,
  StrategyEvaluation,
  RecommendedAction
} from './types'
export { rulesP0StrategyProvider } from './rulesP0Provider'

/**
 * 当前生效的策略提供者。
 * 换引擎时：实现新 Provider，在此切换（或按配置/techVersion 选择）。
 */
let activeProvider: StrategyProvider = rulesP0StrategyProvider

export const getActiveStrategyProvider = (): StrategyProvider => activeProvider

/** 测试或灰度切换用 */
export const setActiveStrategyProvider = (provider: StrategyProvider) => {
  activeProvider = provider
}

export const resetActiveStrategyProvider = () => {
  activeProvider = rulesP0StrategyProvider
}
