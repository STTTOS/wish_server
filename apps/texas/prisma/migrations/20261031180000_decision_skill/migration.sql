-- Decision skill engine: per-action snapshots + player tech aggregate
-- Hole cards intentionally omitted (dirty data).

CREATE TABLE `decision_skill_snapshot` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `matchId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `actionIndex` INTEGER NOT NULL,
    `schemaVersion` INTEGER NOT NULL DEFAULT 1,
    `strategyVersion` VARCHAR(32) NULL,
    `street` VARCHAR(16) NOT NULL,
    `playersInHand` INTEGER NOT NULL,
    `heroPosition` VARCHAR(16) NOT NULL,
    `heroStackBb` DOUBLE NOT NULL,
    `potBb` DOUBLE NOT NULL,
    `toCallBb` DOUBLE NOT NULL,
    `spr` DOUBLE NULL,
    `boardPokes` JSON NOT NULL,
    `boardTexture` VARCHAR(16) NOT NULL,
    `lineTag` VARCHAR(24) NOT NULL,
    `aggressorIsHero` BOOLEAN NOT NULL,
    `actionType` VARCHAR(16) NOT NULL,
    `actionSizeBb` DOUBLE NOT NULL,
    `actionSizePotFrac` DOUBLE NULL,
    `isForced` BOOLEAN NOT NULL DEFAULT false,
    `potOdds` DOUBLE NULL,
    `tier` VARCHAR(16) NULL,
    `nodeScore` DOUBLE NULL,
    `nodeWeight` DOUBLE NULL,
    `scoreReason` VARCHAR(160) NULL,
    `dimension` VARCHAR(16) NULL,
    `scoredAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `decision_skill_snapshot_matchId_userId_actionIndex_key` ON `decision_skill_snapshot`(`matchId`, `userId`, `actionIndex`);
CREATE INDEX `decision_skill_snapshot_userId_matchId_idx` ON `decision_skill_snapshot`(`userId`, `matchId`);
CREATE INDEX `decision_skill_snapshot_matchId_idx` ON `decision_skill_snapshot`(`matchId`);

ALTER TABLE `decision_skill_snapshot` ADD CONSTRAINT `decision_skill_snapshot_matchId_fkey` FOREIGN KEY (`matchId`) REFERENCES `Match`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `decision_skill_snapshot` ADD CONSTRAINT `decision_skill_snapshot_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE `decision_skill_applied_hand` (
    `matchId` INTEGER NOT NULL,
    `techVersion` INTEGER NOT NULL,
    `appliedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`matchId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `decision_skill_applied_hand` ADD CONSTRAINT `decision_skill_applied_hand_matchId_fkey` FOREIGN KEY (`matchId`) REFERENCES `Match`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE `player_tech_stat` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `scope` VARCHAR(16) NOT NULL DEFAULT 'all',
    `techVersion` INTEGER NOT NULL DEFAULT 1,
    `handsScored` INTEGER NOT NULL DEFAULT 0,
    `nodesScored` INTEGER NOT NULL DEFAULT 0,
    `decisionTech` DOUBLE NULL,
    `structureScore` DOUBLE NULL,
    `playerTech` DOUBLE NULL,
    `lastMatchId` INTEGER NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `player_tech_stat_userId_scope_key` ON `player_tech_stat`(`userId`, `scope`);
CREATE INDEX `player_tech_stat_playerTech_idx` ON `player_tech_stat`(`playerTech`);
CREATE INDEX `player_tech_stat_handsScored_idx` ON `player_tech_stat`(`handsScored`);

ALTER TABLE `player_tech_stat` ADD CONSTRAINT `player_tech_stat_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
