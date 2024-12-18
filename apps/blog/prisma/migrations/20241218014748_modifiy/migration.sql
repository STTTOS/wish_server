-- DropForeignKey
ALTER TABLE `MomentLike` DROP FOREIGN KEY `MomentLike_momentId_fkey`;

-- AddForeignKey
ALTER TABLE `MomentLike` ADD CONSTRAINT `MomentLike_momentId_fkey` FOREIGN KEY (`momentId`) REFERENCES `Moment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
