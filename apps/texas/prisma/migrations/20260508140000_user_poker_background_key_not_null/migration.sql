-- 与 Prisma `String @default("default")` 对齐：列非空，缺省为字面量 default
UPDATE `User` SET `pokerBackgroundKey` = 'default' WHERE `pokerBackgroundKey` IS NULL;

ALTER TABLE `User` MODIFY `pokerBackgroundKey` VARCHAR(191) NOT NULL DEFAULT 'default';
