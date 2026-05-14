-- CreateTable
CREATE TABLE `item_definition` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(64) NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `description` VARCHAR(300) NULL,
    `stackable` BOOLEAN NOT NULL DEFAULT true,
    `config` JSON NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `item_definition_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_item_balance` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `itemId` INTEGER NOT NULL,
    `quantity` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `user_item_balance_userId_itemId_key`(`userId`, `itemId`),
    INDEX `user_item_balance_userId_idx`(`userId`),
    INDEX `user_item_balance_itemId_idx`(`itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_item_ledger` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `itemId` INTEGER NOT NULL,
    `delta` INTEGER NOT NULL,
    `balanceAfter` INTEGER NOT NULL,
    `reason` VARCHAR(64) NOT NULL,
    `refType` VARCHAR(64) NULL,
    `refId` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `user_item_ledger_userId_refType_refId_key`(`userId`, `refType`, `refId`),
    INDEX `user_item_ledger_userId_itemId_createdAt_idx`(`userId`, `itemId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `user_item_balance` ADD CONSTRAINT `user_item_balance_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_item_balance` ADD CONSTRAINT `user_item_balance_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `item_definition`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_item_ledger` ADD CONSTRAINT `user_item_ledger_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_item_ledger` ADD CONSTRAINT `user_item_ledger_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `item_definition`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- 预置道具：改名卡
INSERT INTO `item_definition` (`code`, `name`, `description`, `stackable`, `config`, `sortOrder`, `isActive`)
VALUES ('rename_card', '改名卡', '使用后更改游戏内昵称，在牌桌与好友列表中展示。', true, JSON_OBJECT('kind', 'rename_card'), 100, true);

-- 改名卡补给改为邮件系统发放（见后续邮件系统迁移/运维 SQL）
