/**
 * RuntimeKit 层统一导出：运行时读写与恢复策略相关能力。
 */
export { gameRuntimeRegistry, GameRuntimeRegistry } from '../runtimeRegistry'
export { getCurrentMatchIdWithFallback } from '../currentMatch'
export {
  createTexasAndSeatPlayers,
  createInitialMatchAndNotifyEntered
} from '../runtime'
