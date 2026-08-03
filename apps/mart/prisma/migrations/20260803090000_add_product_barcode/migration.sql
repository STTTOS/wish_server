-- AlterTable
ALTER TABLE `Product` ADD COLUMN `barcode` VARCHAR(64) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Product_barcode_key` ON `Product`(`barcode`);
