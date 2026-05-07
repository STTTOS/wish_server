-- CreateTable
CREATE TABLE `asset_usage_event` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NULL,
    `assetType` ENUM('poker_back', 'table_bg') NOT NULL,
    `assetId` VARCHAR(64) NOT NULL,
    `server_ts` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `platform` VARCHAR(16) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `asset_usage_event_asset_type_asset_id_server_ts_idx` ON `asset_usage_event`(`assetType`, `assetId`, `server_ts`);
CREATE INDEX `asset_usage_event_user_id_server_ts_idx` ON `asset_usage_event`(`userId`, `server_ts`);
