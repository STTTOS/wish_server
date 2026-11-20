-- CreateTable
CREATE TABLE `GoldPushRegistration` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `sessionId` BIGINT NOT NULL,
    `expoPushToken` VARCHAR(255) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `GoldPushRegistration_sessionId_key`(`sessionId`),
    INDEX `GoldPushRegistration_expoPushToken_idx`(`expoPushToken`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GoldPriceAlert` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `sessionId` BIGINT NOT NULL,
    `clientAlertId` VARCHAR(64) NOT NULL,
    `label` VARCHAR(128) NOT NULL,
    `targetCnyG` DOUBLE NOT NULL,
    `tolerancePct` DOUBLE NOT NULL DEFAULT 0.2,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `lastTriggeredAt` BIGINT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `GoldPriceAlert_sessionId_enabled_idx`(`sessionId`, `enabled`),
    UNIQUE INDEX `GoldPriceAlert_sessionId_clientAlertId_key`(`sessionId`, `clientAlertId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `GoldPushRegistration` ADD CONSTRAINT `GoldPushRegistration_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `GoldAuthSession`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GoldPriceAlert` ADD CONSTRAINT `GoldPriceAlert_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `GoldAuthSession`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;