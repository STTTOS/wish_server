/**
 * 单一协议来源：从共享包导出 Texas WS/HTTP 合同类型。
 * 前后端都应依赖 `@wishufree/texas-ws-contract`，避免类型漂移。
 */
export type {
  PostGameSendBuiltInVoiceParams,
  PostGameShowMyHandPokesParams,
  PostGameTakeActionParams,
  WsEventDataMap,
  WsEventType,
  WsGameBlindsPostedData,
  WsGameEndData,
  WsGameEndSettleItem,
  WsGameEnteredData,
  WsGameEnteringData,
  WsGameEnteringProgressData,
  WsGameEnteringResolvedData,
  WsGameInvalidatedData,
  WsGameRoomReplayData,
  WsGameRoomReplayItem,
  WsGameStageChangedData,
  WsGameStartData,
  WsMatchOverview,
  WsMatchOverviewBillItem,
  WsMatchOverviewWagerItem,
  WsMessage,
  WsNextHandCountdownCancelledData,
  WsNextHandCountdownStartedData,
  WsPlayerActionRequiredData,
  WsPlayerActionTakenData,
  WsPlayerBuiltInVoiceData,
  WsPlayerChipTopUpData,
  WsPlayerHandDealtData,
  WsPlayerHandVoluntarilyShownData,
  WsPlayerQuitGameData,
  WsPlayerRolesAssignedData
} from '@wishufree/texas-ws-contract'
