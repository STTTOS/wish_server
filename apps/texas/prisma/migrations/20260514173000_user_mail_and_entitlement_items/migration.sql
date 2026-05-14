-- AlterTable
ALTER TABLE `item_definition`
ADD COLUMN `kind` ENUM('consumable', 'entitlement') NOT NULL DEFAULT 'consumable';

-- Backfill existing rows as consumable
UPDATE `item_definition` SET `kind` = 'consumable' WHERE `kind` IS NULL;

-- CreateTable
CREATE TABLE `user_mail` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `title` VARCHAR(120) NOT NULL,
    `summary` VARCHAR(300) NOT NULL,
    `body` TEXT NOT NULL,
    `status` ENUM('unclaimed', 'claimed') NOT NULL DEFAULT 'unclaimed',
    `bizType` VARCHAR(64) NULL,
    `bizRefId` VARCHAR(128) NULL,
    `claimableAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expireAt` DATETIME(3) NOT NULL,
    `claimedAt` DATETIME(3) NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `user_mail_userId_bizType_bizRefId_key`(`userId`, `bizType`, `bizRefId`),
    INDEX `user_mail_userId_status_createdAt_idx`(`userId`, `status`, `createdAt`),
    INDEX `user_mail_userId_expireAt_idx`(`userId`, `expireAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_mail_attachment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `mailId` INTEGER NOT NULL,
    `itemCode` VARCHAR(64) NOT NULL,
    `quantity` INTEGER NOT NULL DEFAULT 1,
    `assetType` VARCHAR(32) NULL,
    `assetKey` VARCHAR(128) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `user_mail_attachment_mailId_idx`(`mailId`),
    INDEX `user_mail_attachment_itemCode_idx`(`itemCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `user_mail` ADD CONSTRAINT `user_mail_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_mail_attachment` ADD CONSTRAINT `user_mail_attachment_mailId_fkey` FOREIGN KEY (`mailId`) REFERENCES `user_mail`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed entitlement item definitions for achievement poker backs
INSERT INTO `item_definition` (`code`, `name`, `description`, `kind`, `stackable`, `config`, `sortOrder`, `isActive`)
VALUES
  ('poker_back:card_back_quads_four_kind_reward', '四喜冠冕', '成就奖励：达成四条牌型解锁。', 'entitlement', false, JSON_OBJECT('grant', JSON_OBJECT('type', 'poker_back', 'assetKey', 'card_back_quads_four_kind_reward')), 1000, true),
  ('poker_back:card_back_straight_flush_reward', '花顺天脊', '成就奖励：达成同花顺牌型解锁。', 'entitlement', false, JSON_OBJECT('grant', JSON_OBJECT('type', 'poker_back', 'assetKey', 'card_back_straight_flush_reward')), 1001, true),
  ('poker_back:card_back_royal_flush_reward', '九冕同辉', '成就奖励：达成皇家同花顺牌型解锁。', 'entitlement', false, JSON_OBJECT('grant', JSON_OBJECT('type', 'poker_back', 'assetKey', 'card_back_royal_flush_reward')), 1002, true)
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `description` = VALUES(`description`),
  `kind` = VALUES(`kind`),
  `stackable` = VALUES(`stackable`),
  `config` = VALUES(`config`),
  `sortOrder` = VALUES(`sortOrder`),
  `isActive` = VALUES(`isActive`);
