-- AlterTable
ALTER TABLE `PrintFile` ADD COLUMN `cosPurgedAt` DATETIME(3) NULL;

-- CreateIndex
CREATE INDEX `PrintFile_cosPurgedAt_createdAt_idx` ON `PrintFile`(`cosPurgedAt`, `createdAt`);
