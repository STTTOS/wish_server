import type { Poke } from 'texas-poker-core'
import type { ParameterizedContext } from 'koa'
import type { FortuneTierKey } from '@prisma/texas-client'

import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'

import response from '../../utils/response'
import { apiPrefixClient } from '../../config'
import combinePath from '../../utils/combinePath'
import { beijingFortuneOn } from './fortuneBeijing'
import router, { type DefaultState } from '../instance'
import prisma, { userDailyFortune } from '../../models'
import { presentationForTierKey } from './fortuneTierCatalog'
import {
  deterministicLuckyPoke,
  deterministicFortuneTierKey
} from './fortuneDrawRandom'

dayjs.extend(utc)

const fortuneClientApi = combinePath(apiPrefixClient)('/fortune')

type FortuneRow = {
  fortuneOn: string
  tierKey: FortuneTierKey
  luckyPoke: Poke
  createdAt: Date
}

type FortuneStatusData = {
  fortuneOn: string
  drawn: boolean
  /** 定局 UTC ISO：由行 `createdAt` 导出（写入时已与哈希使用同一 `Date`） */
  sealedAtUtc: string | null
  tierLabel: string | null
  copyLines: string[] | null
  luckyPoke: Poke | null
  totalDraws: number
}

function toFortuneBody(
  row: FortuneRow,
  drawn: boolean,
  totalDraws: number
): FortuneStatusData {
  if (!drawn) {
    return {
      fortuneOn: row.fortuneOn,
      drawn: false,
      sealedAtUtc: null,
      tierLabel: null,
      copyLines: null,
      luckyPoke: null,
      totalDraws
    }
  }
  const { tierLabel, copyLines } = presentationForTierKey(row.tierKey)
  return {
    fortuneOn: row.fortuneOn,
    drawn: true,
    sealedAtUtc: dayjs.utc(row.createdAt).toISOString(),
    tierLabel,
    copyLines: [...copyLines],
    luckyPoke: row.luckyPoke,
    totalDraws
  }
}

/**
 * 获取当日抽签情况。
 * `fortuneOn` 为中国标准时区（东八区，俗称北京时间）的日历日；代码用 IANA `Asia/Shanghai` 表示该时区。用于 `(userId, fortuneOn)` 唯一约束（每日至多一签）；
 * 跨自然日换日。
 */
router.post(
  fortuneClientApi('/status'),
  async (ctx: ParameterizedContext<DefaultState>) => {
    const userId = ctx.state.user!.id
    const fortuneOn = beijingFortuneOn()

    const [row, totalDraws] = await Promise.all([
      userDailyFortune.findUnique({
        where: { userId_fortuneOn: { userId, fortuneOn } }
      }),
      userDailyFortune.count({ where: { userId } })
    ])

    if (row) {
      response.success(
        ctx,
        toFortuneBody(
          {
            fortuneOn: row.fortuneOn,
            tierKey: row.tierKey,
            luckyPoke: row.luckyPoke as Poke,
            createdAt: row.createdAt
          },
          true,
          totalDraws
        )
      )
      return
    }

    response.success(ctx, {
      fortuneOn,
      drawn: false,
      sealedAtUtc: null,
      tierLabel: null,
      copyLines: null,
      luckyPoke: null,
      totalDraws
    })
  }
)

/**
 * 抽签并落库。档位与幸运牌由 `userId` + **服务端本次处理时的 UTC ISO** 决定（与入库同一瞬间，简单可靠）。
 * `fortuneOn` 仍按上述中国标准时区日历日、每日一行。幂等：同日已抽则 200 返回已存行。
 */
router.post(
  fortuneClientApi('/draw'),
  async (ctx: ParameterizedContext<DefaultState>) => {
    const userId = ctx.state.user!.id
    const fortuneOn = beijingFortuneOn()

    const body = await prisma.$transaction(async (tx) => {
      const existing = await tx.userDailyFortune.findUnique({
        where: { userId_fortuneOn: { userId, fortuneOn } }
      })
      if (existing) {
        const totalDraws = await tx.userDailyFortune.count({
          where: { userId }
        })
        return toFortuneBody(
          {
            fortuneOn: existing.fortuneOn,
            tierKey: existing.tierKey,
            luckyPoke: existing.luckyPoke as Poke,
            createdAt: existing.createdAt
          },
          true,
          totalDraws
        )
      }

      /** 与哈希、`createdAt` 共用同一时刻，避免「先取 ISO 再 INSERT」导致与库时间差几毫秒 */
      const sealedAt = new Date()
      const instantUtc = dayjs.utc(sealedAt).toISOString()
      const tierKey = deterministicFortuneTierKey(userId, instantUtc)
      const luckyPoke = deterministicLuckyPoke(userId, instantUtc)

      const row = await tx.userDailyFortune.create({
        data: {
          userId,
          fortuneOn,
          tierKey,
          luckyPoke,
          createdAt: sealedAt
        }
      })

      const totalDraws = await tx.userDailyFortune.count({ where: { userId } })
      return toFortuneBody(
        {
          fortuneOn: row.fortuneOn,
          tierKey: row.tierKey,
          luckyPoke: row.luckyPoke as Poke,
          createdAt: row.createdAt
        },
        true,
        totalDraws
      )
    })

    response.success(ctx, body, '抽签成功')
  }
)
