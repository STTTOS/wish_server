-- CreateTable
CREATE TABLE `client_connection_event` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `source` VARCHAR(16) NOT NULL DEFAULT 'client',
    `clientEventId` VARCHAR(48) NOT NULL,
    `clientSessionId` VARCHAR(48) NOT NULL,
    `clientTs` DATETIME(3) NOT NULL,
    `kind` VARCHAR(40) NOT NULL,
    `ns` VARCHAR(32) NULL,
    `roomId` INTEGER NULL,
    `matchId` INTEGER NULL,
    `platform` VARCHAR(16) NULL,
    `osVersion` VARCHAR(32) NULL,
    `appVersion` VARCHAR(32) NULL,
    `appState` VARCHAR(16) NULL,
    `netType` VARCHAR(24) NULL,
    `isConnected` BOOLEAN NULL,
    `reason` VARCHAR(120) NULL,
    `sinceSeq` INTEGER NULL,
    `afterSeq` INTEGER NULL,
    `throughSeq` INTEGER NULL,
    `latestSeq` INTEGER NULL,
    `eventCount` INTEGER NULL,
    `truncated` BOOLEAN NULL,
    `recovery` VARCHAR(32) NULL,
    `durationMs` INTEGER NULL,
    `expectedSeq` INTEGER NULL,
    `actualSeq` INTEGER NULL,
    `extra` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `client_connection_event_userId_clientEventId_key`(`userId`, `clientEventId`),
    INDEX `client_connection_event_userId_clientTs_idx`(`userId`, `clientTs`),
    INDEX `client_connection_event_kind_clientTs_idx`(`kind`, `clientTs`),
    INDEX `client_connection_event_roomId_clientTs_idx`(`roomId`, `clientTs`),
    INDEX `client_connection_event_matchId_clientTs_idx`(`matchId`, `clientTs`),
    INDEX `client_connection_event_source_clientTs_idx`(`source`, `clientTs`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `client_connection_event` ADD CONSTRAINT `client_connection_event_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
