-- CreateTable
CREATE TABLE `MatchDomainEvent` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `matchId` INTEGER NOT NULL,
    `roomId` INTEGER NOT NULL,
    `handId` VARCHAR(16) NULL,
    `seq` INTEGER NOT NULL,
    `eventType` VARCHAR(48) NOT NULL,
    `payload` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `MatchDomainEvent_matchId_id_idx` ON `MatchDomainEvent`(`matchId`, `id`);

-- CreateIndex
CREATE INDEX `MatchDomainEvent_matchId_handId_seq_idx` ON `MatchDomainEvent`(`matchId`, `handId`, `seq`);

-- AddForeignKey
ALTER TABLE `MatchDomainEvent` ADD CONSTRAINT `MatchDomainEvent_matchId_fkey` FOREIGN KEY (`matchId`) REFERENCES `Match`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
