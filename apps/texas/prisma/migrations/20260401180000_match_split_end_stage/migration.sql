-- Split Match.endStage into lastActionStage + boardThroughStage (semantic alignment with texas-poker-core onGameEnd)

ALTER TABLE `Match`
  ADD COLUMN `lastActionStage` ENUM('pre_flop', 'flop', 'turn', 'river') NULL,
  ADD COLUMN `boardThroughStage` ENUM('pre_flop', 'flop', 'turn', 'river') NULL;

UPDATE `Match`
SET
  `lastActionStage` = `endStage`,
  `boardThroughStage` = `endStage`
WHERE `endStage` IS NOT NULL;

ALTER TABLE `Match` DROP COLUMN `endStage`;
