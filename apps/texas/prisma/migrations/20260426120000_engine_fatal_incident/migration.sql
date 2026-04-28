-- CreateTable
CREATE TABLE `EngineFatalIncident` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `roomId` INTEGER NOT NULL,
    `matchId` INTEGER NOT NULL,
    `message` VARCHAR(512) NOT NULL,
    `payload` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `EngineFatalIncident_roomId_createdAt_idx` ON `EngineFatalIncident`(`roomId`, `createdAt`);

-- CreateIndex
CREATE INDEX `EngineFatalIncident_matchId_idx` ON `EngineFatalIncident`(`matchId`);

-- AddForeignKey
ALTER TABLE `EngineFatalIncident` ADD CONSTRAINT `EngineFatalIncident_roomId_fkey` FOREIGN KEY (`roomId`) REFERENCES `Room`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
