-- CreateTable
CREATE TABLE `Tick` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `ts` BIGINT NOT NULL,
    `usdOz` DOUBLE NOT NULL,
    `usdCny` DOUBLE NULL,
    `cnyG` DOUBLE NULL,
    `source` VARCHAR(32) NOT NULL,
    `sourceUpdatedAt` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Tick_ts_key`(`ts`),
    INDEX `Tick_ts_idx`(`ts`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DailyBar` (
    `date` VARCHAR(10) NOT NULL,
    `ts` BIGINT NOT NULL,
    `open` DOUBLE NOT NULL,
    `high` DOUBLE NOT NULL,
    `low` DOUBLE NOT NULL,
    `close` DOUBLE NOT NULL,
    `source` VARCHAR(64) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    INDEX `DailyBar_ts_idx`(`ts`),
    PRIMARY KEY (`date`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
