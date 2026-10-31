/**
 * 运维雷达风格标签：读时由物化轴/计数派生，不落库。
 */

export type StyleTagTone = 'sample' | 'style' | 'leak'

export type StyleTag = {
  key: string
  label: string
  tone: StyleTagTone
  hint: string
}

export type DeriveStyleTagsInput = {
  hands: number
  sampleStatus: 'insufficient' | 'reference' | 'ok'
  vpip: number | null
  pfr: number | null
  wtsd: number | null
  wsd: number | null
  skill: number | null
  popAvgSkill: number | null
  limpHands: number
}

const TAG_MIN_HANDS = 50

/**
 * 从已物化指标派生标签。样本不足时只回样本标签。
 */
export const deriveStyleTags = (input: DeriveStyleTagsInput): StyleTag[] => {
  const tags: StyleTag[] = []

  if (input.sampleStatus === 'insufficient') {
    tags.push({
      key: 'sample_insufficient',
      label: '样本不足',
      tone: 'sample',
      hint: '手数不足 50，风格标签暂不判定。'
    })
    return tags
  }
  if (input.sampleStatus === 'reference') {
    tags.push({
      key: 'sample_reference',
      label: '参考样本',
      tone: 'sample',
      hint: '手数尚少，标签仅供参考。'
    })
  }
  // sampleStatus === 'ok'：不再挂「可信样本」标签（表头样本状态已有「可信」）

  if (input.hands < TAG_MIN_HANDS) return tags

  const vpip = input.vpip
  const pfr = input.pfr
  if (vpip != null && pfr != null) {
    // PFR/VPIP：≥0.7 偏主动，<0.55 偏被动（对齐常见 HUD 分类）
    const pfrRatio = vpip > 0 ? pfr / vpip : 1
    if (vpip <= 28 && pfrRatio >= 0.7) {
      tags.push({
        key: 'style_tight_aggro',
        label: '紧凶',
        tone: 'style',
        hint: '入池偏紧且加注比例高（PFR/VPIP≥70%）。'
      })
    } else if (vpip <= 28 && pfrRatio < 0.55) {
      tags.push({
        key: 'style_passive_tight',
        label: '紧被动',
        tone: 'style',
        hint: '入池偏紧，翻前较少主动加注（PFR/VPIP<55%）。'
      })
    } else if (vpip >= 40 && pfrRatio >= 0.7) {
      tags.push({
        key: 'style_lag',
        label: '松凶',
        tone: 'style',
        hint: '入池偏松，且入池多靠加注（PFR/VPIP≥70%）。'
      })
    } else if (vpip >= 40 && pfrRatio < 0.55) {
      tags.push({
        key: 'style_fish',
        label: '松被动',
        tone: 'style',
        hint: '入池很松且加注占比偏低（PFR/VPIP<55%），偏 limp / 冷跟。'
      })
    } else {
      tags.push({
        key: 'style_reg',
        label: '常规',
        tone: 'style',
        hint: '松紧与主动度落在中间带（未到紧/松×凶/被动的极端）。'
      })
    }
  }

  const wtsd = input.wtsd
  const wsd = input.wsd
  if (wtsd != null && wsd != null && wtsd >= 35 && wsd < 45) {
    tags.push({
      key: 'leak_calling_station',
      label: '爱跟到底',
      tone: 'leak',
      hint: '看翻后常跟到摊牌，但摊牌胜率偏低（打法漏洞）。'
    })
  }

  // 绝对值门槛（相对常规牌局），不是 vs 全站均值；本站好友局整体偏松时仍可能触发
  if (vpip != null && vpip >= 55) {
    tags.push({
      key: 'leak_vpip_high',
      label: '入池过松',
      tone: 'leak',
      hint: 'VPIP ≥ 55%（绝对值，非相对全站）。常规牌局里属过宽；本站均值更高时，相对全站仍可能偏紧。'
    })
  }

  const limpRate = input.hands > 0 ? input.limpHands / input.hands : 0
  if (limpRate >= 0.2) {
    tags.push({
      key: 'leak_limp',
      label: '爱 limp',
      tone: 'leak',
      hint: `约 ${(limpRate * 100).toFixed(0)}% 手数为 limp 入池。`
    })
  }

  if (
    input.skill != null &&
    input.popAvgSkill != null &&
    input.skill <= input.popAvgSkill - 15
  ) {
    tags.push({
      key: 'leak_skill_low',
      label: '技术偏弱',
      tone: 'leak',
      hint: `技术分低于全站均值约 ${(input.popAvgSkill - input.skill).toFixed(
        0
      )} 分。`
    })
  }

  return tags
}
