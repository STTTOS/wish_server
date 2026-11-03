-- 纪律快照瘦身：去掉 spr / board / texture / aggressor / heroStack；
-- strategyVersion → rulesVersion；表改名 decision_skill_* → discipline_*

RENAME TABLE `decision_skill_snapshot` TO `discipline_action_snapshot`;
RENAME TABLE `decision_skill_applied_hand` TO `discipline_applied_hand`;

ALTER TABLE `discipline_action_snapshot`
  CHANGE COLUMN `strategyVersion` `rulesVersion` VARCHAR(32) NULL,
  DROP COLUMN `spr`,
  DROP COLUMN `boardPokes`,
  DROP COLUMN `boardTexture`,
  DROP COLUMN `aggressorIsHero`,
  DROP COLUMN `heroStackBb`;

-- 旧索引名（若存在）随表重命名后可能仍带旧前缀；统一重建
ALTER TABLE `discipline_action_snapshot`
  DROP INDEX `decision_skill_snapshot_matchId_userId_actionIndex_key`,
  DROP INDEX `decision_skill_snapshot_userId_matchId_idx`,
  DROP INDEX `decision_skill_snapshot_matchId_idx`;

CREATE UNIQUE INDEX `discipline_action_snapshot_matchId_userId_actionIndex_key`
  ON `discipline_action_snapshot`(`matchId`, `userId`, `actionIndex`);
CREATE INDEX `discipline_action_snapshot_userId_matchId_idx`
  ON `discipline_action_snapshot`(`userId`, `matchId`);
CREATE INDEX `discipline_action_snapshot_matchId_idx`
  ON `discipline_action_snapshot`(`matchId`);
