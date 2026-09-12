-- CreateTable
CREATE TABLE `Road` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `sort` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Road_name_key`(`name`),
    INDEX `Road_sort_idx`(`sort`),
    INDEX `Road_name_idx`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable
ALTER TABLE `RoadSign` ADD COLUMN `roadName` VARCHAR(100) NOT NULL DEFAULT '';

-- CreateIndex
CREATE INDEX `RoadSign_roadName_idx` ON `RoadSign`(`roadName`);
