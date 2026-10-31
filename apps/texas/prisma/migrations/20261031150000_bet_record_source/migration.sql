-- AlterTable
ALTER TABLE `BetRecord` ADD COLUMN `source` ENUM('blind', 'action') NOT NULL DEFAULT 'action';

-- CreateIndex
CREATE INDEX `BetRecord_source_idx` ON `BetRecord`(`source`);
