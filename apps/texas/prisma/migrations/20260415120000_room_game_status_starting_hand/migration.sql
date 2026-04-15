-- AlterTable: add `starting_hand` between entering and in_hand (MySQL enum order)
ALTER TABLE `Room` MODIFY COLUMN `gameStatus` ENUM(
  'waiting',
  'entering',
  'starting_hand',
  'in_hand',
  'between_hands'
) NOT NULL DEFAULT 'waiting';
