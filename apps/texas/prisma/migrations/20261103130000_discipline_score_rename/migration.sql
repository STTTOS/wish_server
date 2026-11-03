-- 技术分 → 纪律分：重命名用户聚合表与字段；applied_hand.techVersion → disciplineVersion

ALTER TABLE `decision_skill_applied_hand`
  CHANGE COLUMN `techVersion` `disciplineVersion` INTEGER NOT NULL;

RENAME TABLE `player_tech_stat` TO `player_discipline_stat`;

ALTER TABLE `player_discipline_stat`
  CHANGE COLUMN `techVersion` `disciplineVersion` INTEGER NOT NULL DEFAULT 2,
  CHANGE COLUMN `decisionTech` `actionScore` DOUBLE NULL,
  CHANGE COLUMN `structureScore` `habitScore` DOUBLE NULL,
  CHANGE COLUMN `playerTech` `disciplineScore` DOUBLE NULL;

-- 索引名随列变更
ALTER TABLE `player_discipline_stat`
  DROP INDEX `player_tech_stat_playerTech_idx`,
  DROP INDEX `player_tech_stat_handsScored_idx`,
  DROP INDEX `player_tech_stat_userId_scope_key`;

CREATE UNIQUE INDEX `player_discipline_stat_userId_scope_key` ON `player_discipline_stat`(`userId`, `scope`);
CREATE INDEX `player_discipline_stat_disciplineScore_idx` ON `player_discipline_stat`(`disciplineScore`);
CREATE INDEX `player_discipline_stat_handsScored_idx` ON `player_discipline_stat`(`handsScored`);

-- FK 约束名（MySQL 可能保留旧名；若失败可手工核对）
ALTER TABLE `player_discipline_stat`
  DROP FOREIGN KEY `player_tech_stat_userId_fkey`;
ALTER TABLE `player_discipline_stat`
  ADD CONSTRAINT `player_discipline_stat_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
