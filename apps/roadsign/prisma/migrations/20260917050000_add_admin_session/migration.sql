-- CreateTable
CREATE TABLE `AdminSession` (
    `username` VARCHAR(64) NOT NULL,
    `sessionId` VARCHAR(64) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`username`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
