-- 技术分 → 纪律分：重命名用户聚合表与字段；applied_hand.techVersion → disciplineVersion
-- 注意：userId FK 依赖 (userId, scope) 唯一索引的左前缀，须先丢 FK 再改索引名

ALTER TABLE `decision_skill_applied_hand`
  CHANGE COLUMN `techVersion` `disciplineVersion` INTEGER NOT NULL;

RENAME TABLE `player_tech_stat` TO `player_discipline_stat`;

ALTER TABLE `player_discipline_stat`
  CHANGE COLUMN `techVersion` `disciplineVersion` INTEGER NOT NULL DEFAULT 2,
  CHANGE COLUMN `decisionTech` `actionScore` DOUBLE NULL,
  CHANGE COLUMN `structureScore` `habitScore` DOUBLE NULL,
  CHANGE COLUMN `playerTech` `disciplineScore` DOUBLE NULL;

-- FK 依赖唯一索引左前缀，先去掉再重命名索引
ALTER TABLE `player_discipline_stat`
  DROP FOREIGN KEY `player_tech_stat_userId_fkey`;

ALTER TABLE `player_discipline_stat`
  RENAME INDEX `player_tech_stat_userId_scope_key` TO `player_discipline_stat_userId_scope_key`,
  RENAME INDEX `player_tech_stat_handsScored_idx` TO `player_discipline_stat_handsScored_idx`,
  RENAME INDEX `player_tech_stat_playerTech_idx` TO `player_discipline_stat_disciplineScore_idx`;

ALTER TABLE `player_discipline_stat`
  ADD CONSTRAINT `player_discipline_stat_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
