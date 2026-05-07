/**
 * 管理端「运行时设置」展示用：字段说明与分组（与 `GameRuntimeConfigPatch` 对齐）。
 */
export type RuntimeConfigFieldGroup = 'websocket' | 'nextHand' | 'firstHand'

export type RuntimeConfigFieldDef = {
  /** 与 `GameRuntimeConfigPatch` 键一致 */
  key:
    | 'actionRequiredWsDelayMs'
    | 'stageChangedWsDelayMs'
    | 'startGameBeforeAssignRolesDelayMs'
    | 'nextHandCountdownPushDelayMs'
    | 'nextHandLockAtOffsetMs'
    | 'nextHandLockedTailBeforeEndsMs'
    | 'nextHandDealAfterEndMs'
    | 'nextHandStartAfterDealMs'
  label: string
  group: RuntimeConfigFieldGroup
  /** 面向运维的详细说明（多句） */
  description: string
  minMs: number
  maxMs: number
}

export const runtimeConfigFieldDefinitions: RuntimeConfigFieldDef[] = [
  {
    key: 'actionRequiredWsDelayMs',
    label: '行动后 WS 间隔',
    group: 'websocket',
    minMs: 0,
    maxMs: 120_000,
    description:
      '某位玩家完成行动（跟注、弃牌等）之后，到引擎向客户端推送下一条「需要行动」或相关 WS 消息之间的最短等待。用于给客户端动画、筹码飞入留出时间；过小会显得卡顿或消息「抢跑」，过大则牌局拖沓。单位：毫秒。'
  },
  {
    key: 'stageChangedWsDelayMs',
    label: '进街 / 阶段 WS 间隔',
    group: 'websocket',
    minMs: 0,
    maxMs: 120_000,
    description:
      '引擎在「待处理操作队列」里连续推进多条 WS 时，相邻两条之间的间隔（例如翻公牌、切换街道）。摊牌后、在推送本手 `game-end` 之前的停顿也复用该值（不推迟 `game-stage-changed` 本身）。过小玩家看不清街面变化，过大拖慢节奏。单位：毫秒。'
  },
  {
    key: 'startGameBeforeAssignRolesDelayMs',
    label: '首局分配角色前延迟',
    group: 'firstHand',
    minMs: 0,
    maxMs: 120_000,
    description:
      '首局所有人进桌、房主触发开始后，到服务端真正分配座位与角色之前的延迟。用于等待进桌过渡 UI、避免刚进桌就立刻弹行动条。单位：毫秒。'
  },
  {
    key: 'nextHandCountdownPushDelayMs',
    label: '局间倒计时推送延迟',
    group: 'nextHand',
    minMs: 0,
    maxMs: 120_000,
    description:
      '上一手结束并已向客户端下发 `game-end` 之后，再等待多久才广播 `next-hand-countdown-started`（带 lockAt / endsAt）。应与客户端结算展示时长大致对齐，避免倒计时与结算 UI 重叠。单位：毫秒。'
  },
  {
    key: 'nextHandLockAtOffsetMs',
    label: '锁座时刻（相对倒计时起点）',
    group: 'nextHand',
    minMs: 0,
    maxMs: 120_000,
    description:
      '从 `next-hand-countdown-started` 报文中的 `serverNow` 起算，经过多少毫秒到达「锁座」时刻：此后不可再退出本局。须不晚于「分配角色」时刻；与下一项「锁座后尾段」相加即为客户端常用的整段局间倒计时长度。单位：毫秒。'
  },
  {
    key: 'nextHandLockedTailBeforeEndsMs',
    label: '锁座后至分配角色的尾段',
    group: 'nextHand',
    minMs: 0,
    maxMs: 120_000,
    description:
      '从锁座时刻起，到「分配角色」时刻（endsAt）之间的时间。与「锁座时刻」相加得到 `endsAt` 相对 `serverNow` 的偏移；请勿再单独配置 ends 总偏移，以免与锁座顺序矛盾。为 0 时锁座与分配角色同一时刻触发。单位：毫秒。'
  },
  {
    key: 'nextHandDealAfterEndMs',
    label: '分配角色后发牌延迟',
    group: 'nextHand',
    minMs: 0,
    maxMs: 120_000,
    description:
      '到达 `endsAt`（分配角色并落库）之后，再延迟多久执行发牌逻辑。用于角色展示、座位动画等。单位：毫秒。'
  },
  {
    key: 'nextHandStartAfterDealMs',
    label: '发牌后开局延迟',
    group: 'nextHand',
    minMs: 0,
    maxMs: 120_000,
    description:
      '发牌完成后再延迟多久调用 `controller.start` 正式进入下一手牌局流程。单位：毫秒。'
  }
]
