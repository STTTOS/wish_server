-- CreateTable
CREATE TABLE `DailyQuality` (
    `date` VARCHAR(10) NOT NULL,
    `tickCount` INTEGER NOT NULL,
    `expectedTicks` INTEGER NOT NULL,
    `coveragePct` DOUBLE NOT NULL,
    `gapCount` INTEGER NOT NULL,
    `maxGapMs` INTEGER NOT NULL,
    `firstTickAt` BIGINT NULL,
    `lastTickAt` BIGINT NULL,
    `dailyBarSource` VARCHAR(64) NULL,
    `dailyBarFrozen` BOOLEAN NOT NULL DEFAULT false,
    `currencyCloseDiff` DOUBLE NULL,
    `currencyCloseUsd` DOUBLE NULL,
    `tickCloseUsd` DOUBLE NULL,
    `note` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`date`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
