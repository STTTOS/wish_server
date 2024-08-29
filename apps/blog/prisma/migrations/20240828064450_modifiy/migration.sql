-- AlterTable
ALTER TABLE `Comment` ADD COLUMN `rootId` INTEGER NULL;

-- AddForeignKey
ALTER TABLE `Comment` ADD CONSTRAINT `Comment_rootId_fkey` FOREIGN KEY (`rootId`) REFERENCES `Comment`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
