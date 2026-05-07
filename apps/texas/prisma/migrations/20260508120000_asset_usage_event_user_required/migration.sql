-- 删除无用户归属的占位行（若有）；卡背/牌桌打点仅登录态
DELETE FROM `asset_usage_event` WHERE `userId` IS NULL;

-- AlterTable
ALTER TABLE `asset_usage_event` MODIFY `userId` INTEGER NOT NULL;

-- AddForeignKey
ALTER TABLE `asset_usage_event` ADD CONSTRAINT `asset_usage_event_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
