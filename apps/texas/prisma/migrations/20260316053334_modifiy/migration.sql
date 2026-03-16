/*
  Warnings:

  - You are about to drop the column `maxPresentation` on the `Match` table. All the data in the column will be lost.
  - You are about to drop the column `hand` on the `PlayerMatchRecord` table. All the data in the column will be lost.
  - You are about to drop the column `presentation` on the `PlayerMatchRecord` table. All the data in the column will be lost.
  - You are about to alter the column `role` on the `PlayerMatchRecord` table. The data in that column could be lost. The data in that column will be cast from `VarChar(191)` to `Enum(EnumId(0))`.
  - Added the required column `handPokes` to the `PlayerMatchRecord` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `Match` DROP COLUMN `maxPresentation`,
    ADD COLUMN `bestRankCategory` ENUM('z', 'y', 'x', 'w', 'v', 'u', 't', 's', 'r', 'q') NULL;

-- AlterTable
ALTER TABLE `PlayerMatchRecord` DROP COLUMN `hand`,
    DROP COLUMN `presentation`,
    ADD COLUMN `handPokes` JSON NOT NULL,
    ADD COLUMN `rankCategory` ENUM('z', 'y', 'x', 'w', 'v', 'u', 't', 's', 'r', 'q') NULL,
    ADD COLUMN `rankSignature` VARCHAR(191) NULL,
    ADD COLUMN `rankStrength` INTEGER NOT NULL DEFAULT 0,
    MODIFY `role` ENUM('btn', 'sb', 'bb', 'utg', 'utg1', 'utg2', 'mp', 'lj', 'hj', 'co') NULL;
