-- 纪律快照瘦身：去掉 spr / board / texture / aggressor / heroStack；
-- strategyVersion → rulesVersion；表改名 decision_skill_* → discipline_*
-- 索引仅重命名，避免 drop 唯一键与 FK 冲突

RENAME TABLE `decision_skill_snapshot` TO `discipline_action_snapshot`;
RENAME TABLE `decision_skill_applied_hand` TO `discipline_applied_hand`;

ALTER TABLE `discipline_action_snapshot`
  CHANGE COLUMN `strategyVersion` `rulesVersion` VARCHAR(32) NULL,
  MODIFY COLUMN `schemaVersion` INTEGER NOT NULL DEFAULT 2,
  DROP COLUMN `spr`,
  DROP COLUMN `boardPokes`,
  DROP COLUMN `boardTexture`,
  DROP COLUMN `aggressorIsHero`,
  DROP COLUMN `heroStackBb`;

ALTER TABLE `discipline_action_snapshot`
  RENAME INDEX `decision_skill_snapshot_matchId_userId_actionIndex_key`
    TO `discipline_action_snapshot_matchId_userId_actionIndex_key`,
  RENAME INDEX `decision_skill_snapshot_userId_matchId_idx`
    TO `discipline_action_snapshot_userId_matchId_idx`,
  RENAME INDEX `decision_skill_snapshot_matchId_idx`
    TO `discipline_action_snapshot_matchId_idx`;
