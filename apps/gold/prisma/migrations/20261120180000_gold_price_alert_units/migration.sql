-- AlterTable: 美元/盎司 与 元/克 双口径
ALTER TABLE `GoldPriceAlert` ADD COLUMN `quoteUnit` VARCHAR(8) NOT NULL DEFAULT 'cnyG';
ALTER TABLE `GoldPriceAlert` ADD COLUMN `targetUsdOz` DOUBLE NULL;
ALTER TABLE `GoldPriceAlert` MODIFY `targetCnyG` DOUBLE NULL;