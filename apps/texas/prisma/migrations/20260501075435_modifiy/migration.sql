-- AlterTable
ALTER TABLE `Room` ADD COLUMN `sevenTwoBonusEnabled` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `tableType` ENUM('quick', 'standard', 'deep', 'custom') NOT NULL DEFAULT 'standard';

-- Backfill historical inconsistent data
UPDATE `Room`
SET `tableType` = 'custom'
WHERE `tableType` IS NULL;
