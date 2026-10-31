/* eslint-disable no-console */

/**
 * 全量重建决策技术分（清 DecisionSkillSnapshot / AppliedHand / PlayerTechStat 后按 ended match 重算）。
 *
 * 前置建议：
 *   1) npm run backfill:bet-record-source -- --apply   # 若 source 未齐
 *   2) npm run backfill:style-stats                   # 结构分依赖牌风轴
 *
 *   cd apps/texas
 *   npm run backfill:decision-skill
 *
 * 可选：
 *   npm run backfill:decision-skill -- --no-clear   # 不清表，只补未 Applied 的手（幂等投影）
 */
import { rebuildDecisionSkillFromMatches } from '../src/decisionSkill/backfill'

const main = async () => {
  const clearFirst = !process.argv.includes('--no-clear')
  const result = await rebuildDecisionSkillFromMatches({ clearFirst })
  console.log('decisionSkill backfill done', result)
  process.exit(result.failed > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
