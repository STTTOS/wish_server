-- CreateTable
CREATE TABLE `RoadSign` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(200) NOT NULL,
    `description` VARCHAR(1000) NOT NULL DEFAULT '',
    `extra` TEXT NOT NULL,
    `lng` DOUBLE NOT NULL,
    `lat` DOUBLE NOT NULL,
    `type` ENUM('existing', 'planned') NOT NULL,
    `status` ENUM('todo', 'doing', 'done') NOT NULL DEFAULT 'todo',
    `direction` ENUM('ew', 'we', 'ns', 'sn') NOT NULL,
    `level` ENUM('l1', 'l2') NOT NULL,
    `signPhoto` JSON NULL,
    `extraPhotos` JSON NOT NULL DEFAULT ('[]'),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `RoadSign_status_idx`(`status`),
    INDEX `RoadSign_type_idx`(`type`),
    INDEX `RoadSign_name_idx`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
