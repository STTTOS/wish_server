-- DropForeignKey
ALTER TABLE `Moment` DROP FOREIGN KEY `Moment_timelineId_fkey`;

-- DropForeignKey
ALTER TABLE `Timeline` DROP FOREIGN KEY `Timeline_userId_fkey`;

-- AlterTable
ALTER TABLE `Timeline` ADD COLUMN `cover` VARCHAR(191) NULL;

-- AddForeignKey
ALTER TABLE `Timeline` ADD CONSTRAINT `Timeline_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Moment` ADD CONSTRAINT `Moment_timelineId_fkey` FOREIGN KEY (`timelineId`) REFERENCES `Timeline`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
