import { ActionTypeEnum, type TableCommand } from 'texas-poker-core'

/**
 * HTTP/用例层的 `ActionTypeEnum` → Core `TableCommand`。
 */
export function actionToTableCommand(
  userId: number,
  actionType: ActionTypeEnum,
  amount: number
): TableCommand {
  switch (actionType) {
    case ActionTypeEnum.FOLD:
      return { type: 'Fold', playerId: userId }
    case ActionTypeEnum.CHECK:
      return { type: 'Check', playerId: userId }
    case ActionTypeEnum.CALL:
      return { type: 'Call', playerId: userId }
    case ActionTypeEnum.BET:
      return { type: 'Bet', playerId: userId, amount }
    case ActionTypeEnum.RAISE:
      return { type: 'Raise', playerId: userId, additionalAmount: amount }
    case ActionTypeEnum.ALL_IN:
      return { type: 'AllIn', playerId: userId }
    default: {
      const _exhaustive: never = actionType
      throw new Error(`unsupported action: ${_exhaustive}`)
    }
  }
}
